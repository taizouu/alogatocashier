"""
Emisión y registro de boletas y facturas electrónicas (OpenFactura).

Flujo al vender (ver ProcesarVentaView):
  1. `leer_pedido` valida qué documento se pide ANTES de guardar la venta.
  2. Se guarda la venta (como siempre).
  3. `emitir_para_venta` crea el registro PENDIENTE y llama a la API con una
     clave de idempotencia fija por venta y tipo: si la red se corta y se
     reintenta, OpenFactura devuelve el documento ya emitido en vez de crear
     otro. Si la emisión falla, la venta queda hecha y el documento en ERROR,
     listo para reintentar desde la pantalla Documentos.

Endpoints:
  GET  /api/documentos/configuracion/        ¿está activa la emisión? ambiente
  GET  /api/documentos/?desde&hasta&tipo&estado   registro (admin)
  POST /api/documentos/<id>/reintentar/      (admin)
  POST /api/documentos/<id>/estado/          consulta el estado en el SII (admin)
  GET  /api/documentos/<id>/pdf/             PDF del documento
  GET  /api/contribuyente/<rut>/             datos del SII para llenar una factura
"""
import base64
import logging

from django.conf import settings
from django.db import IntegrityError, transaction
from django.http import HttpResponse
from django.utils import timezone
from rest_framework import generics, serializers, status
from rest_framework.pagination import PageNumberPagination
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from . import openfactura
from .devoluciones import estado_lineas
from .dte import BOLETA, DocumentoInvalido, construir_boleta, construir_factura, normalizar_rut
from .fechas import RangoInvalido, rango_del_dia
from .models import DocumentoTributario, SesionCaja, VentaLocal
from .permissions import IsAdmin
from usuarios.models import obtener_rol

logger = logging.getLogger(__name__)


def configuracion():
    return settings.OPENFACTURA


def _emisor():
    emisor = configuracion()['emisor']
    faltan = [campo for campo in ('rut', 'razon_social', 'giro', 'acteco', 'direccion', 'comuna') if not emisor.get(campo)]
    if faltan:
        raise DocumentoInvalido("Faltan datos del emisor en la configuración: " + ", ".join(faltan))
    return emisor


def _lineas(venta):
    # Lo cobrado por línea (con promociones; en ventas antiguas, repartido del total)
    return [{'nombre': d.nombre_producto, 'cantidad': d.cantidad, 'total': cobrado}
            for d, _, _, cobrado in estado_lineas(venta).values()]


# ---------- Emisión ----------

def emitir_para_venta(venta, pedido, usuario):
    """Crea el registro y emite. Devuelve el DocumentoTributario (EMITIDO o ERROR)."""
    if venta.documentos.filter(estado__in=['EMITIDO', 'PENDIENTE'], tipo__in=[33, 39]).exists():
        raise DocumentoInvalido("Esta venta ya tiene una boleta o factura.")
    ambiente = configuracion()['ambiente']
    receptor = pedido.get('receptor') or {}
    try:
        documento = DocumentoTributario.objects.create(
            venta=venta, tipo=pedido['tipo'], ambiente=ambiente, usuario=usuario,
            idempotency_key=f"alogato-{ambiente}-venta{venta.id}-dte{pedido['tipo']}",
            monto_total=int(venta.total), email=pedido.get('email') or '',
            receptor=receptor, receptor_rut=receptor.get('rut', ''),
            receptor_razon_social=receptor.get('razon_social', '')[:100],
        )
    except IntegrityError:
        # Ya existe un registro de este tipo para la venta (p. ej. uno con error): se reintenta ese
        documento = DocumentoTributario.objects.get(
            idempotency_key=f"alogato-{ambiente}-venta{venta.id}-dte{pedido['tipo']}")
    return emitir(documento)


def emitir(documento):
    """Llama a OpenFactura para un documento PENDIENTE o con ERROR. Nunca lanza: deja el resultado registrado."""
    documento.intentos += 1
    documento.error = ''
    try:
        lineas = _lineas(documento.venta)
        hoy = timezone.localdate()
        if documento.tipo == BOLETA:
            dte = construir_boleta(lineas, _emisor(), documento.venta.metodo_pago, fecha=hoy)
            diferencia, formato = 0, '80MM'
        else:
            dte, diferencia = construir_factura(lineas, _emisor(), documento.receptor, fecha=hoy)
            formato = 'LETTER'
        documento.monto_total = dte['Encabezado']['Totales']['MntTotal']
        documento.diferencia = diferencia

        try:
            respuesta = openfactura.emitir(dte, documento.idempotency_key, formato_pdf=formato,
                                           correo=documento.email or None)
            documento.token = respuesta.get('TOKEN', '')
            documento.folio = respuesta.get('FOLIO')
            documento.advertencia = str(respuesta.get('WARNING') or '')[:500]
        except openfactura.ErrorOpenFactura as e:
            if e.codigo != 'OF-06' or not e.token:
                raise
            # Idempotencia: ya se había emitido (reintento tras un corte). Recuperamos ese documento.
            documento.token = e.token
            documento.folio = (openfactura.consultar(e.token, 'json') or {}).get('folio')

        documento.estado = 'EMITIDO'
        documento.emitido_en = timezone.now()
    except DocumentoInvalido as e:
        documento.estado, documento.error = 'ERROR', str(e)
    except openfactura.ErrorOpenFactura as e:
        documento.estado = 'ERROR'
        documento.error = str(e)
        if e.sin_respuesta:
            documento.error += (" — Puede que el documento sí se haya emitido: al reintentar se usa la "
                                "misma clave, así que OpenFactura no lo duplicará (válido por 24 horas).")
    except Exception as e:
        logger.exception("Error inesperado al emitir el documento %s", documento.id)
        documento.estado, documento.error = 'ERROR', f"Error inesperado: {e}"
    documento.save()
    return documento


# ---------- Serializer ----------

class DocumentoSerializer(serializers.ModelSerializer):
    tipo_nombre = serializers.CharField(source='get_tipo_display')
    estado_nombre = serializers.CharField(source='get_estado_display')
    usuario = serializers.CharField(source='usuario.username')
    venta_total = serializers.IntegerField(source='venta.total')
    venta_metodo_pago = serializers.CharField(source='venta.get_metodo_pago_display')

    class Meta:
        model = DocumentoTributario
        fields = ['id', 'venta', 'venta_total', 'venta_metodo_pago', 'tipo', 'tipo_nombre', 'estado',
                  'estado_nombre', 'ambiente', 'folio', 'monto_total', 'diferencia', 'receptor_rut',
                  'receptor_razon_social', 'email', 'estado_sii', 'error', 'advertencia', 'intentos',
                  'usuario', 'creado', 'emitido_en']


# ---------- Vistas ----------

class ConfiguracionDocumentosView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        config = configuracion()
        return Response({"activo": config['activo'], "ambiente": config['ambiente']})


class PaginacionDocumentos(PageNumberPagination):
    page_size = 50


class DocumentoListView(generics.ListAPIView):
    permission_classes = [IsAuthenticated, IsAdmin]
    serializer_class = DocumentoSerializer
    pagination_class = PaginacionDocumentos

    def list(self, request, *args, **kwargs):
        try:
            return super().list(request, *args, **kwargs)
        except RangoInvalido as e:
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)

    def get_queryset(self):
        params = self.request.query_params
        inicio, fin = rango_del_dia(params.get('desde'), params.get('hasta'))
        documentos = DocumentoTributario.objects.select_related('venta', 'usuario').filter(
            creado__gte=inicio, creado__lt=fin)
        if params.get('tipo'):
            documentos = documentos.filter(tipo=params['tipo'])
        if params.get('estado'):
            documentos = documentos.filter(estado=params['estado'])
        return documentos


def _documento_de(pk, usuario):
    """Documento visible para el usuario: el vendedor solo ve los de ventas de la caja abierta."""
    documentos = DocumentoTributario.objects.select_related('venta')
    if obtener_rol(usuario) != 'ADMIN':
        sesion = SesionCaja.objects.filter(estado='ABIERTA').first()
        documentos = documentos.filter(venta__sesion=sesion) if sesion else documentos.none()
    return documentos.filter(pk=pk).first()


class ReintentarDocumentoView(APIView):
    permission_classes = [IsAuthenticated, IsAdmin]

    def post(self, request, pk):
        with transaction.atomic():
            documento = DocumentoTributario.objects.select_for_update().filter(pk=pk).first()
            if not documento:
                return Response({"error": "El documento no existe."}, status=status.HTTP_404_NOT_FOUND)
            if documento.estado != 'ERROR':
                return Response({"error": "Solo se reintentan documentos con error."}, status=status.HTTP_400_BAD_REQUEST)
            otro = documento.venta.documentos.filter(estado__in=['EMITIDO', 'PENDIENTE'], tipo__in=[33, 39]) \
                .exclude(pk=documento.pk).first()
            if otro:
                return Response({"error": f"La venta ya tiene {otro.get_tipo_display().lower()} "
                                          f"{'N° ' + str(otro.folio) if otro.folio else '(en proceso)'}: no se emite otra."},
                                status=status.HTTP_400_BAD_REQUEST)
            documento.estado = 'PENDIENTE'
            documento.save(update_fields=['estado'])
        documento = emitir(documento)
        return Response(DocumentoSerializer(documento).data)


class EstadoDocumentoView(APIView):
    """Consulta en OpenFactura si el SII ya aceptó el documento."""
    permission_classes = [IsAuthenticated, IsAdmin]

    def post(self, request, pk):
        documento = DocumentoTributario.objects.filter(pk=pk).first()
        if not documento or not documento.token:
            return Response({"error": "El documento no tiene token (no fue emitido)."}, status=status.HTTP_400_BAD_REQUEST)
        try:
            respuesta = openfactura.consultar(documento.token, 'status') or {}
        except openfactura.ErrorOpenFactura as e:
            return Response({"error": str(e)}, status=status.HTTP_502_BAD_GATEWAY)
        documento.estado_sii = str(respuesta.get('estado') or '')[:30]
        documento.save(update_fields=['estado_sii'])
        return Response(DocumentoSerializer(documento).data)


class PdfDocumentoView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        documento = _documento_de(pk, request.user)
        if not documento or not documento.token:
            return Response({"error": "Documento no disponible."}, status=status.HTTP_404_NOT_FOUND)
        try:
            respuesta = openfactura.consultar(documento.token, 'pdf') or {}
            contenido = base64.b64decode(respuesta.get('pdf') or '')
        except (openfactura.ErrorOpenFactura, ValueError) as e:
            return Response({"error": f"No se pudo obtener el PDF: {e}"}, status=status.HTTP_502_BAD_GATEWAY)
        if not contenido:
            return Response({"error": "OpenFactura no devolvió el PDF."}, status=status.HTTP_502_BAD_GATEWAY)
        nombre = f"{documento.get_tipo_display().split()[0].lower()}-{documento.folio or documento.id}.pdf"
        respuesta_http = HttpResponse(contenido, content_type='application/pdf')
        respuesta_http['Content-Disposition'] = f'inline; filename="{nombre}"'
        return respuesta_http


class ContribuyenteView(APIView):
    """Datos del SII de un RUT, para completar la factura sin escribirlos a mano."""
    permission_classes = [IsAuthenticated]

    def get(self, request, rut):
        try:
            rut = normalizar_rut(rut)
            datos = openfactura.contribuyente(rut) or {}
        except DocumentoInvalido as e:
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)
        except openfactura.ErrorOpenFactura as e:
            return Response({"error": str(e)}, status=status.HTTP_502_BAD_GATEWAY)
        if not datos.get('razonSocial'):
            return Response({"error": "El SII no tiene datos para ese RUT."}, status=status.HTTP_404_NOT_FOUND)
        actividad = next((a for a in datos.get('actividades') or [] if a and a.get('giro')), {})
        return Response({
            "rut": rut,
            "razon_social": datos.get('razonSocial') or '',
            "giro": actividad.get('giro') or '',
            "direccion": datos.get('direccion') or '',
            "comuna": datos.get('comuna') or '',
            "email": datos.get('email') or '',
        })
