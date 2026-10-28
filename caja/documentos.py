"""
Emisión y registro de boletas y facturas electrónicas (OpenFactura).

Flujo al vender (ver ProcesarVentaView):
  1. `leer_pedido` valida qué documento se pide ANTES de guardar la venta.
  2. Se guarda la venta (como siempre).
  3. `emitir_para_venta` crea el registro PENDIENTE y llama a la API con una
     clave de idempotencia propia del registro (se mantiene en los reintentos):
     si la red se corta y se reintenta, OpenFactura devuelve el documento ya
     emitido en vez de crear otro (OpenFactura la recuerda 24 horas). Si la emisión falla, la venta queda hecha y el documento en ERROR,
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
import uuid
from datetime import timedelta

from django.conf import settings
from django.db import transaction
from django.http import HttpResponse
from django.utils import timezone
from rest_framework import generics, serializers, status
from rest_framework.pagination import PageNumberPagination
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from . import openfactura
from .devoluciones import estado_lineas
from .dte import (BOLETA, FACTURA, NOTA_CREDITO, DocumentoInvalido, construir_boleta, construir_factura,
                  construir_nota_credito, folio_de, normalizar_rut)
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

# Un envío sin respuesta por más de este tiempo se considera interrumpido
ENVIO_INTERRUMPIDO = timedelta(minutes=5)
# OpenFactura recuerda la clave de idempotencia por 24 horas (con margen)
VIGENCIA_CLAVE = timedelta(hours=23)


def emitir_para_venta(venta, pedido, usuario):
    """Crea el registro y emite. Devuelve el DocumentoTributario (EMITIDO o ERROR)."""
    if venta.documentos.filter(estado__in=['EMITIDO', 'PENDIENTE'], tipo__in=[33, 39]).exists():
        raise DocumentoInvalido("Esta venta ya tiene una boleta o factura.")
    ambiente = configuracion()['ambiente']
    receptor = pedido.get('receptor') or {}
    # Clave única por registro (no solo por N° de venta: si la base se reinicia,
    # los N° se repiten y OpenFactura devolvería el documento de otra venta)
    documento = DocumentoTributario.objects.create(
        venta=venta, tipo=pedido['tipo'], ambiente=ambiente, usuario=usuario,
        idempotency_key=f"alogato-{ambiente}-venta{venta.id}-dte{pedido['tipo']}-{uuid.uuid4().hex[:12]}",
        monto_total=int(venta.total), email=pedido.get('email') or '',
        receptor=receptor, receptor_rut=receptor.get('rut', ''),
        receptor_razon_social=receptor.get('razon_social', '')[:100],
        estado='PENDIENTE', intentado_en=timezone.now(),
    )
    return emitir(documento)


def emitir_nota_credito(devolucion, usuario):
    """
    Nota de crédito automática por una devolución, si la venta tiene una boleta o
    factura emitida por la caja. Devuelve el DocumentoTributario, o None si no
    corresponde (emisión desactivada, venta sin documento de la caja, p. ej.
    con tarjeta: ese documento lo emitió el POS TUU).
    """
    config = configuracion()
    if not config['activo']:
        return None
    original = devolucion.venta.documentos.filter(tipo__in=[BOLETA, FACTURA], estado='EMITIDO').first()
    if not original:
        return None
    existente = devolucion.notas_credito.filter(estado__in=['EMITIDO', 'PENDIENTE']).first()
    if existente:
        return existente
    documento = DocumentoTributario.objects.create(
        venta=devolucion.venta, devolucion=devolucion, referencia=original, tipo=NOTA_CREDITO,
        ambiente=original.ambiente, usuario=usuario,
        idempotency_key=f"alogato-{original.ambiente}-dev{devolucion.id}-dte61-{uuid.uuid4().hex[:12]}",
        monto_total=int(devolucion.total), email=original.email,
        receptor=original.receptor, receptor_rut=original.receptor_rut,
        receptor_razon_social=original.receptor_razon_social,
        estado='PENDIENTE', intentado_en=timezone.now(),
    )
    return emitir(documento)


def _armar_nota_credito(documento, hoy):
    """(dte, diferencia, formato PDF) de una nota de crédito."""
    devolucion, original = documento.devolucion, documento.referencia
    if not devolucion or not original:
        raise DocumentoInvalido("La nota de crédito no tiene su devolución o documento original.")
    lineas = [{'nombre': d.detalle_venta.nombre_producto, 'cantidad': d.cantidad, 'total': d.monto}
              for d in devolucion.detalles.select_related('detalle_venta').order_by('id')]
    # "Anula" solo si esta devolución deja la venta en cero y no hubo devoluciones antes
    anula = devolucion.es_anulacion and not devolucion.venta.devoluciones.filter(id__lt=devolucion.id).exists()
    referencia = {
        'tipo': original.tipo, 'folio': original.folio,
        'fecha': timezone.localtime(original.emitido_en).date() if original.emitido_en else hoy,
        'anula': anula, 'razon': devolucion.motivo,
    }
    receptor = original.receptor if original.tipo == FACTURA else None
    dte, diferencia = construir_nota_credito(lineas, _emisor(), referencia, receptor=receptor, fecha=hoy)
    return dte, diferencia, ('80MM' if original.tipo == BOLETA else 'LETTER')


def _recuperar(documento):
    """Documento que ya tiene token (ya fue emitido): se busca su folio sin volver a emitir."""
    if not documento.folio and documento.token:
        try:
            documento.folio = folio_de(openfactura.consultar(documento.token, 'json'))
        except openfactura.ErrorOpenFactura as e:
            # Está emitido igual; el folio se puede ver en OpenFactura
            documento.advertencia = f"Emitido, pero no se pudo obtener el folio: {e}"[:500]
    documento.estado = 'EMITIDO'
    documento.emitido_en = documento.emitido_en or timezone.now()


def emitir(documento):
    """Llama a OpenFactura para un documento PENDIENTE o con ERROR. Nunca lanza: deja el resultado registrado."""
    documento.intentos += 1
    documento.error = ''
    documento.intentado_en = timezone.now()
    if documento.token:
        # Ya se emitió en un intento anterior: nunca se vuelve a enviar
        _recuperar(documento)
        documento.sin_respuesta = False
        documento.save()
        return documento
    try:
        if documento.ambiente != configuracion()['ambiente']:
            raise DocumentoInvalido(
                f"Este documento es del ambiente '{documento.ambiente}' y la caja ahora está en "
                f"'{configuracion()['ambiente']}': no se emite.")
        hoy = timezone.localdate()
        if documento.tipo == NOTA_CREDITO:
            dte, diferencia, formato = _armar_nota_credito(documento, hoy)
        else:
            if documento.venta.devoluciones.exists():
                raise DocumentoInvalido("La venta tiene devoluciones: emite el documento manualmente en OpenFactura.")
            lineas = _lineas(documento.venta)
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

        documento.sin_respuesta = False
        _recuperar(documento)   # completa el folio si la respuesta no lo traía
    except DocumentoInvalido as e:
        documento.estado, documento.error = 'ERROR', str(e)
    except openfactura.ErrorOpenFactura as e:
        documento.estado = 'ERROR'
        documento.error = str(e)
        documento.sin_respuesta = bool(e.sin_respuesta) or documento.sin_respuesta
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
    referencia_texto = serializers.SerializerMethodField()

    def get_referencia_texto(self, documento):
        # Nota de crédito: a qué documento corrige ("Boleta electrónica N° 1234")
        ref = documento.referencia
        if not ref:
            return ''
        return f"{ref.get_tipo_display()}{' N° ' + str(ref.folio) if ref.folio else ''}"

    class Meta:
        model = DocumentoTributario
        fields = ['id', 'venta', 'venta_total', 'venta_metodo_pago', 'tipo', 'tipo_nombre', 'estado',
                  'estado_nombre', 'ambiente', 'folio', 'monto_total', 'diferencia', 'receptor_rut',
                  'receptor_razon_social', 'email', 'estado_sii', 'error', 'advertencia', 'intentos',
                  'usuario', 'creado', 'emitido_en', 'devolucion', 'referencia_texto']


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
        documentos = DocumentoTributario.objects.select_related('venta', 'usuario', 'referencia').filter(
            creado__gte=inicio, creado__lt=fin)
        if params.get('tipo') in ('33', '39', '61'):
            documentos = documentos.filter(tipo=int(params['tipo']))
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
            ahora = timezone.now()
            interrumpido = (documento.estado == 'PENDIENTE' and
                            (documento.intentado_en or documento.creado) < ahora - ENVIO_INTERRUMPIDO)
            if documento.estado != 'ERROR' and not interrumpido:
                return Response({"error": "Solo se reintentan documentos con error (o envíos interrumpidos "
                                          "hace más de 5 minutos)."}, status=status.HTTP_400_BAD_REQUEST)
            posible_emitido = documento.sin_respuesta or interrumpido
            if (posible_emitido and not documento.token and not request.data.get('confirmado')
                    and documento.creado < ahora - VIGENCIA_CLAVE):
                # Pasadas 24 h OpenFactura ya no reconoce la clave: reintentar podría duplicar el documento
                return Response({
                    "error": (f"Un envío anterior de la venta #{documento.venta_id} quedó sin respuesta hace más de "
                              "24 horas y pudo emitirse igual. Revisa en OpenFactura si esa venta ya tiene "
                              "documento antes de emitir otro."),
                    "requiere_confirmacion": True,
                }, status=status.HTTP_409_CONFLICT)
            if documento.tipo == NOTA_CREDITO:
                hermanos = DocumentoTributario.objects.filter(devolucion_id=documento.devolucion_id, tipo=NOTA_CREDITO)
            else:
                hermanos = documento.venta.documentos.filter(tipo__in=[33, 39])
            otro = hermanos.filter(estado__in=['EMITIDO', 'PENDIENTE']) \
                .exclude(pk=documento.pk).first()
            if otro:
                return Response({"error": f"La venta ya tiene {otro.get_tipo_display().lower()} "
                                          f"{'N° ' + str(otro.folio) if otro.folio else '(en proceso)'}: no se emite otra."},
                                status=status.HTTP_400_BAD_REQUEST)
            documento.estado = 'PENDIENTE'
            documento.intentado_en = ahora
            documento.save(update_fields=['estado', 'intentado_en'])
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
