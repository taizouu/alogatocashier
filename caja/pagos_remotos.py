"""
Pago remoto TUU: la caja envía el cobro con tarjeta al POS y espera la respuesta.

Flujo (ver ModalPago.jsx):
  1. POST /api/pagos-tuu/ {monto, metodo}: crea el registro y envía el cobro al POS.
  2. La caja consulta GET /api/pagos-tuu/<id>/ cada pocos segundos mientras el
     cliente pasa la tarjeta.
  3. Con el pago COMPLETADO, la caja registra la venta enviando `pago_remoto_id`
     (ProcesarVentaView valida que esté aprobado, sea por el mismo monto y no
     se haya usado en otra venta).
  Si la venta no alcanzó a registrarse (se cortó la red, se cerró la ventana),
  GET /api/pagos-tuu/sin-venta/ muestra los cobros aprobados sin venta de la
  caja abierta, para usarlos en vez de cobrarle de nuevo al cliente.

Endpoints:
  GET  /api/pagos-tuu/configuracion/   ¿está activo el pago remoto?
  POST /api/pagos-tuu/                 enviar un cobro al POS
  GET  /api/pagos-tuu/<id>/            estado (consulta a TUU si sigue en curso)
  GET  /api/pagos-tuu/sin-venta/       cobros aprobados aún sin venta (caja abierta)
  POST /api/pagos-tuu/<id>/descartar/  cobro aprobado sin venta que se anuló en el POS

Reglas para no cobrar dos veces:
  - No se envía un cobro nuevo si hay uno en curso, ni si hay uno aprobado
    sin venta por el mismo monto (se ofrece usar ese).
  - Un cobro aprobado nunca vuelve atrás de estado ni pierde su venta.
  - La caja no se cierra con cobros en curso o aprobados sin venta.
"""
import logging
import uuid
from datetime import timedelta

from django.conf import settings
from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from rest_framework import serializers, status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from . import tuu
from .models import PagoRemoto, SesionCaja
from usuarios.models import obtener_rol

logger = logging.getLogger(__name__)

# No se consulta a TUU más seguido que esto aunque la caja pregunte más rápido
INTERVALO_CONSULTA = timedelta(seconds=2)
# Si tras este tiempo TUU dice que el cobro no existe, el envío no llegó
GRACIA_NO_ENCONTRADO = timedelta(seconds=30)
# Un cobro en curso más antiguo que esto ya no bloquea enviar uno nuevo
CURSO_VIGENTE = timedelta(minutes=10)


def configuracion():
    return settings.TUU_PAGO_REMOTO


class PagoRemotoSerializer(serializers.ModelSerializer):
    estado_nombre = serializers.CharField(source='get_estado_display')
    metodo_nombre = serializers.CharField(source='get_metodo_display')
    usuario = serializers.CharField(source='usuario.username')

    class Meta:
        model = PagoRemoto
        fields = ['id', 'monto', 'metodo', 'metodo_nombre', 'estado', 'estado_nombre', 'codigo_operacion',
                  'error', 'venta', 'usuario', 'creado']


CAMPOS_ESTADO = ['estado', 'error', 'codigo_operacion', 'respuesta', 'consultado_en']


def actualizar(pago, datos):
    """Aplica una respuesta de TUU al registro (sin guardar). Un cobro aprobado no vuelve atrás."""
    if pago.estado not in tuu.EN_CURSO:
        return
    estado, operacion, monto = tuu.interpretar(datos)
    pago.respuesta = datos or {}
    if operacion:
        pago.codigo_operacion = operacion
    if estado:
        pago.estado = estado
        pago.error = ''
    if estado == 'COMPLETADO' and monto is not None and monto != pago.monto:
        # No debería pasar (el monto lo fija la caja): el cliente pagó, pero no se usa sin revisar
        pago.estado = 'REVISAR'
        pago.error = (f"TUU informó un cobro por ${monto:,} y se envió ${pago.monto:,}. "
                      "Revisa el cobro en el POS.").replace(',', '.')


def refrescar(pago):
    """Consulta a TUU un cobro en curso y guarda el resultado. Nunca lanza."""
    ahora = timezone.now()
    if pago.estado not in tuu.EN_CURSO:
        return pago
    # Se "reserva" la consulta en la base: si otra petición consultó hace poco, no se repite
    reservado = PagoRemoto.objects.filter(pk=pago.pk, estado__in=tuu.EN_CURSO).filter(
        Q(consultado_en__isnull=True) | Q(consultado_en__lt=ahora - INTERVALO_CONSULTA)
    ).update(consultado_en=ahora)
    if not reservado:
        pago.refresh_from_db()
        return pago

    datos, error = None, None
    try:
        datos = tuu.consultar_cobro(pago.idempotency_key)
    except tuu.ErrorTuu as e:
        error = e

    with transaction.atomic():
        # Se relee bloqueado: otra consulta pudo haberlo aprobado (y usado) mientras tanto
        pago = PagoRemoto.objects.select_for_update().get(pk=pago.pk)
        if pago.estado not in tuu.EN_CURSO:
            return pago
        pago.consultado_en = ahora
        if error is None:
            actualizar(pago, datos)
        elif error.codigo == 'RP-200' and ahora - pago.creado > GRACIA_NO_ENCONTRADO:
            pago.estado = 'ERROR'
            pago.error = "El cobro no llegó al POS. Puedes enviarlo de nuevo."
        else:
            # Error pasajero (red, límite de consultas): se sigue esperando
            pago.error = str(error)
        pago.save(update_fields=CAMPOS_ESTADO)
    return pago


def refrescar_en_curso(sesion):
    """Actualiza los cobros en curso de la sesión (p. ej. tras "Dejar de esperar")."""
    for pago in sesion.pagos_remotos.filter(estado__in=tuu.EN_CURSO):
        refrescar(pago)


def pendientes_de_sesion(sesion):
    """Cobros que impiden cerrar la caja: en curso (recientes), o aprobados sin venta."""
    return sesion.pagos_remotos.filter(
        Q(estado__in=tuu.EN_CURSO, creado__gte=timezone.now() - CURSO_VIGENTE) |
        Q(estado__in=tuu.APROBADOS, venta__isnull=True))


def _sesion_abierta():
    return SesionCaja.objects.filter(estado='ABIERTA').first()


def _pago_visible(pk, usuario):
    """El vendedor solo ve los cobros de la caja abierta; el admin, todos."""
    pagos = PagoRemoto.objects.select_related('usuario')
    if obtener_rol(usuario) != 'ADMIN':
        sesion = _sesion_abierta()
        pagos = pagos.filter(sesion=sesion) if sesion else pagos.none()
    return pagos.filter(pk=pk).first()


# ---------- Vistas ----------

class ConfiguracionPagoRemotoView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        config = configuracion()
        return Response({
            "activo": config['activo'],
            "listo": bool(config['activo'] and config['api_key'] and config['dispositivo']),
        })


class CrearPagoRemotoView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        config = configuracion()
        if not config['activo']:
            return Response({"error": "El pago remoto TUU está desactivado."}, status=status.HTTP_400_BAD_REQUEST)
        try:
            monto = int(round(float(request.data.get('monto'))))
        except (TypeError, ValueError):
            return Response({"error": "Monto inválido."}, status=status.HTTP_400_BAD_REQUEST)
        metodo = str(request.data.get('metodo') or '').upper()
        clave = uuid.uuid4().hex   # 32 caracteres (TUU acepta hasta 36)
        try:
            cuerpo = tuu.construir_solicitud(clave, monto, metodo, config['dispositivo'],
                                             descripcion='Venta AloGato', dte_tipo=config['dte_tipo'])
        except ValueError as e:
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)

        with transaction.atomic():
            # Bloqueo de la sesión: dos clics seguidos no envían dos cobros
            sesion = SesionCaja.objects.select_for_update().filter(estado='ABIERTA').first()
            if not sesion:
                return Response({"error": "No hay una sesión de caja abierta."}, status=status.HTTP_400_BAD_REQUEST)
            en_curso = sesion.pagos_remotos.filter(
                estado__in=tuu.EN_CURSO, creado__gte=timezone.now() - CURSO_VIGENTE).first()
            if en_curso:
                en_curso = refrescar(en_curso)
                if en_curso.estado in tuu.EN_CURSO:
                    return Response({
                        "error": "Ya hay un cobro esperando en el POS. Termínalo o cancélalo en el POS primero.",
                        "pago": PagoRemotoSerializer(en_curso).data,
                    }, status=status.HTTP_409_CONFLICT)
            # Un cobro ya aprobado por este monto y sin venta: se usa ese, no se cobra otra vez
            aprobado = sesion.pagos_remotos.filter(estado='COMPLETADO', venta__isnull=True, monto=monto).first()
            if aprobado:
                return Response({
                    "error": "Ya hay un cobro aprobado por este monto que no tiene venta: se usará ese.",
                    "pago": PagoRemotoSerializer(aprobado).data,
                }, status=status.HTTP_409_CONFLICT)
            pago = PagoRemoto.objects.create(
                sesion=sesion, usuario=request.user, idempotency_key=clave, monto=monto, metodo=metodo,
                dispositivo=config['dispositivo'], estado='PENDIENTE')

        try:
            actualizar(pago, tuu.crear_cobro(cuerpo))
        except tuu.ErrorTuu as e:
            if e.sin_respuesta:
                # Pudo llegar al POS: se sigue consultando con la misma clave
                pago.error = str(e)
            else:
                pago.estado, pago.error = 'ERROR', str(e)
        pago.consultado_en = timezone.now()
        pago.save(update_fields=CAMPOS_ESTADO)

        datos = PagoRemotoSerializer(pago).data
        if pago.estado == 'ERROR':
            return Response({"error": pago.error, "pago": datos}, status=status.HTTP_400_BAD_REQUEST)
        return Response(datos, status=status.HTTP_201_CREATED)


class PagoRemotoDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        pago = _pago_visible(pk, request.user)
        if not pago:
            return Response({"error": "Cobro no encontrado."}, status=status.HTTP_404_NOT_FOUND)
        return Response(PagoRemotoSerializer(refrescar(pago)).data)


class PagosSinVentaView(APIView):
    """Cobros aprobados en el POS que todavía no tienen venta (caja abierta)."""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        sesion = _sesion_abierta()
        if not sesion:
            return Response([])
        # Un cobro que se dejó de esperar pudo aprobarse después: se consulta antes de listar
        refrescar_en_curso(sesion)
        pagos = sesion.pagos_remotos.select_related('usuario').filter(estado__in=tuu.APROBADOS, venta__isnull=True)
        return Response(PagoRemotoSerializer(pagos, many=True).data)


class DescartarPagoRemotoView(APIView):
    """Cobro aprobado sin venta que el cajero anuló en el POS: deja de bloquear la caja."""
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        with transaction.atomic():
            pago = _pago_visible(pk, request.user)
            pago = pago and PagoRemoto.objects.select_for_update().get(pk=pago.pk)
            if not pago:
                return Response({"error": "Cobro no encontrado."}, status=status.HTTP_404_NOT_FOUND)
            if pago.estado not in tuu.APROBADOS or pago.venta_id:
                return Response({"error": "Solo se descartan cobros aprobados que no tienen venta."},
                                status=status.HTTP_400_BAD_REQUEST)
            pago.estado = 'DESCARTADO'
            pago.error = f"Descartado por {request.user.username} el {timezone.localtime():%d-%m-%Y %H:%M} (anulado en el POS)."
            pago.save(update_fields=['estado', 'error'])
        return Response(PagoRemotoSerializer(pago).data)
