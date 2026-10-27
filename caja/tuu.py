"""
Cliente de la API de Pago remoto de TUU (Haulmer), versión v2 con idempotencia.

Documentación: https://developers.tuu.cl/docs/pago-remoto
- Host: https://integrations.payment.haulmer.com, header `X-API-Key`
  (Espacio de trabajo → Pagos → Configuración → API).
- POST /RemotePayment/v2/Create: envía el cobro al POS (debe estar en "Modo Integración").
- GET  /RemotePayment/v2/GetPaymentRequest/<idempotencyKey>: estado del cobro.
- Estados: Pending 0, Sent 1, Canceled 2, Processing 3, Failed 4, Completed 5
  (pueden llegar como texto o como número; se aceptan ambos).
- Límites: monto entre 100 y 99.999.999; 1 cobro por minuto por POS; máx. 5 en cola.
- Errores: {"code": "...", "message": "..."}.

Las funciones puras (estado_desde, construir_solicitud) no dependen de Django,
para poder probarlas sin servidor.
"""
import logging

logger = logging.getLogger(__name__)

TIMEOUT_SEGUNDOS = 20
MONTO_MINIMO = 100
MONTO_MAXIMO = 99_999_999
METODOS = {'DEBITO': 2, 'CREDITO': 1}

# Estados de TUU → estado local
_ESTADOS = {
    'pending': 'PENDIENTE', '0': 'PENDIENTE',
    'sent': 'ENVIADO', '1': 'ENVIADO',
    'canceled': 'CANCELADO', 'cancelled': 'CANCELADO', '2': 'CANCELADO',
    'processing': 'PROCESANDO', '3': 'PROCESANDO',
    'failed': 'FALLIDO', '4': 'FALLIDO',
    'completed': 'COMPLETADO', '5': 'COMPLETADO',
}
EN_CURSO = ('PENDIENTE', 'ENVIADO', 'PROCESANDO')
# Aprobados: el cliente ya pagó (REVISAR = aprobado con un monto distinto al enviado)
APROBADOS = ('COMPLETADO', 'REVISAR')

# Mensajes claros para los errores más probables en la tienda
_MENSAJES = {
    'KEY-002': "Falta la API key de TUU (TUU_API_KEY).",
    'KEY-003': "La API key de TUU no es válida. Revisa TUU_API_KEY (Pagos → Configuración → API).",
    'MR-100': "El POS no está asociado a esta API key.",
    'MR-161': "No se encontró el POS con ese número de serie. Revisa TUU_POS_SERIAL.",
    'RP-029': "El POS no tiene la configuración necesaria. ¿Está en Modo Integración?",
    'RP-032': "El POS no acepta ese tipo de tarjeta (débito/crédito).",
    'MR-110': "El monto mínimo para cobrar con tarjeta es $100.",
    'RP-028': "El monto mínimo para cobrar con tarjeta es $100.",
    'MR-180': "El POS tiene demasiados cobros en espera. Termina o cancela los pendientes en el POS.",
    'MR-203': "El cobro todavía se está procesando en el POS.",
    'INT-MIDDLEWARE-429': "TUU permite enviar un cobro por minuto al POS. Espera un momento y reintenta.",
}


class ErrorTuu(Exception):
    def __init__(self, mensaje, codigo='', estado_http=None, sin_respuesta=False):
        super().__init__(mensaje)
        self.codigo = codigo
        self.estado_http = estado_http
        self.sin_respuesta = sin_respuesta   # corte de red: el cobro PUDO haber llegado al POS


def estado_desde(valor):
    """Traduce el estado de TUU ('Completed', 5, ...) al estado local. None si es desconocido."""
    if valor is None:
        return None
    return _ESTADOS.get(str(valor).strip().lower())


def construir_solicitud(clave, monto, metodo, dispositivo, descripcion='', dte_tipo=0):
    """Cuerpo de POST /RemotePayment/v2/Create. Lanza ValueError si un dato no es válido."""
    monto = int(monto)
    if not MONTO_MINIMO <= monto <= MONTO_MAXIMO:
        raise ValueError(f"El monto para cobrar con tarjeta debe estar entre ${MONTO_MINIMO} y ${MONTO_MAXIMO:,}."
                         .replace(',', '.'))
    if metodo not in METODOS:
        raise ValueError("Elige débito o crédito.")
    if not dispositivo:
        raise ValueError("Falta el número de serie del POS (TUU_POS_SERIAL).")
    if not 1 <= len(clave) <= 36:
        raise ValueError("Clave de idempotencia inválida.")
    # Solo ASCII: TUU rechaza caracteres especiales en algunos campos
    descripcion = descripcion.encode('ascii', 'ignore').decode()[:60]
    return {
        'idempotencyKey': clave,
        'amount': monto,
        'device': dispositivo,
        'description': descripcion,
        'dteType': int(dte_tipo),
        'paymentMethod': METODOS[metodo],
        'extradata': {'sourceName': 'AloGato Cashier'},
    }


def interpretar(datos):
    """De la respuesta de Create/GetPaymentRequest: (estado local o None, N° de operación, monto o None)."""
    datos = datos or {}
    estado = estado_desde(datos.get('status') if 'status' in datos else datos.get('Status'))
    operacion = str(datos.get('sequenceNumber') or datos.get('SequenceNumber') or '').strip()[:40]
    try:
        monto = int(datos['amount']) if datos.get('amount') is not None else None
    except (TypeError, ValueError):
        monto = None
    return estado, operacion, monto


def _error_desde_respuesta(respuesta):
    try:
        datos = respuesta.json()
    except ValueError:
        datos = {}
    if not isinstance(datos, dict):
        datos = {}
    if isinstance(datos.get('error'), dict):
        datos = datos['error']
    codigo = str(datos.get('code') or datos.get('Code') or '')
    mensaje = datos.get('message') or datos.get('Message') or respuesta.reason or 'Error desconocido'
    if respuesta.status_code == 429 and not codigo:
        codigo = 'INT-MIDDLEWARE-429'
    if respuesta.status_code == 401 and not codigo:
        codigo = 'KEY-003'
    texto = _MENSAJES.get(codigo) or f"{codigo + ': ' if codigo else ''}{mensaje}"
    return ErrorTuu(texto, codigo=codigo, estado_http=respuesta.status_code)


def _peticion(metodo, ruta, cuerpo=None):
    import requests
    from django.conf import settings

    config = settings.TUU_PAGO_REMOTO
    if not config.get('api_key'):
        raise ErrorTuu(_MENSAJES['KEY-002'], codigo='KEY-002')
    try:
        respuesta = requests.request(
            metodo, f"{config['url']}{ruta}", json=cuerpo, timeout=TIMEOUT_SEGUNDOS,
            headers={'X-API-Key': config['api_key'], 'Content-Type': 'application/json'},
        )
    except requests.RequestException as e:
        logger.warning("TUU sin respuesta en %s %s: %s", metodo, ruta, e)
        raise ErrorTuu("TUU no respondió (sin conexión o demasiado lento).", sin_respuesta=True)
    if respuesta.status_code >= 500:
        # Error del lado de TUU: la solicitud pudo haberse procesado igual
        logger.warning("TUU respondió %s en %s %s", respuesta.status_code, metodo, ruta)
        raise ErrorTuu(f"TUU tuvo un problema (error {respuesta.status_code}).", estado_http=respuesta.status_code,
                       sin_respuesta=True)
    if respuesta.status_code >= 400:
        error = _error_desde_respuesta(respuesta)
        logger.warning("TUU respondió %s en %s %s: %s", respuesta.status_code, metodo, ruta, error)
        raise error
    try:
        datos = respuesta.json()
    except ValueError:
        datos = {}
    # Algunas APIs envuelven la respuesta en "data"
    if isinstance(datos, dict) and isinstance(datos.get('data'), dict):
        datos = datos['data']
    return datos if isinstance(datos, dict) else {}


def crear_cobro(cuerpo):
    return _peticion('POST', '/RemotePayment/v2/Create', cuerpo)


def consultar_cobro(clave):
    return _peticion('GET', f'/RemotePayment/v2/GetPaymentRequest/{clave}')
