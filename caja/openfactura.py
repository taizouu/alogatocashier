"""
Cliente HTTP mínimo de la API de OpenFactura (Haulmer), versión v2.

Documentación: https://docsapi-openfactura.haulmer.com/
- Autenticación con el header `apikey`.
- Emisión: POST /document con `Idempotency-Key` (vigencia 24 h): si se repite
  la clave, OpenFactura responde OF-06 con el token del documento ya emitido,
  así un reintento nunca crea un documento duplicado.
- Los errores llegan en dos formas: {"error": {message, code, details}} o
  {message, code, details} sin envoltorio. Se aceptan ambas.
"""
import logging

import requests
from django.conf import settings

logger = logging.getLogger(__name__)
TIMEOUT_SEGUNDOS = 30


class ErrorOpenFactura(Exception):
    def __init__(self, mensaje, codigo='', estado_http=None, token=None, sin_respuesta=False):
        super().__init__(mensaje)
        self.codigo = codigo
        self.estado_http = estado_http
        self.token = token                  # en OF-06: token del documento ya emitido
        self.sin_respuesta = sin_respuesta  # corte de red o timeout: el documento PUDO haberse emitido


def _buscar_token(datos):
    """Busca un token en cualquier parte de una respuesta de error (OF-06)."""
    if isinstance(datos, dict):
        for clave, valor in datos.items():
            if clave.lower() == 'token' and isinstance(valor, str) and valor:
                return valor
            encontrado = _buscar_token(valor)
            if encontrado:
                return encontrado
    elif isinstance(datos, list):
        for valor in datos:
            encontrado = _buscar_token(valor)
            if encontrado:
                return encontrado
    return None


def _error_desde_respuesta(respuesta):
    try:
        datos = respuesta.json()
    except ValueError:
        datos = {}
    cuerpo = datos.get('error') if isinstance(datos.get('error'), dict) else datos
    codigo = str(cuerpo.get('code') or '')
    mensaje = cuerpo.get('message') or respuesta.reason or 'Error desconocido'
    detalles = cuerpo.get('details')
    if isinstance(detalles, list):
        extra = '; '.join(f"{d.get('field', '')}: {d.get('issue', '')}".strip(': ') for d in detalles if isinstance(d, dict))
    elif isinstance(detalles, dict):
        extra = '; '.join(f"{k}: {v}" for k, v in detalles.items())
    else:
        extra = ''

    if respuesta.status_code in (401, 403):
        mensaje = "API key de OpenFactura inválida o sin permisos"
    elif respuesta.status_code == 429:
        mensaje = "Demasiadas solicitudes a OpenFactura; intenta en unos segundos"
    texto = f"{codigo + ': ' if codigo else ''}{mensaje}{' (' + extra + ')' if extra else ''}"
    return ErrorOpenFactura(texto, codigo=codigo, estado_http=respuesta.status_code, token=_buscar_token(datos))


def _peticion(metodo, ruta, cuerpo=None, cabeceras=None):
    config = settings.OPENFACTURA
    if not config.get('api_key'):
        raise ErrorOpenFactura("Falta configurar OPENFACTURA_API_KEY")
    try:
        respuesta = requests.request(
            metodo, f"{config['url']}{ruta}", json=cuerpo, timeout=TIMEOUT_SEGUNDOS,
            headers={'apikey': config['api_key'], 'Content-Type': 'application/json', **(cabeceras or {})},
        )
    except (requests.Timeout, requests.ConnectionError) as e:
        raise ErrorOpenFactura(f"OpenFactura no respondió ({e.__class__.__name__})", sin_respuesta=True)
    if respuesta.status_code == 204:
        return None
    if not respuesta.ok:
        raise _error_desde_respuesta(respuesta)
    try:
        return respuesta.json()
    except ValueError:
        raise ErrorOpenFactura("OpenFactura respondió algo que no es JSON", estado_http=respuesta.status_code)


def emitir(dte, clave_idempotencia, formato_pdf='80MM', correo=None):
    """Emite un DTE. Devuelve {'TOKEN', 'FOLIO', 'WARNING'?}."""
    cuerpo = {'response': ['FOLIO', formato_pdf], 'dte': dte}
    if correo:
        cuerpo['sendEmail'] = {'to': correo}
    return _peticion('POST', '/document', cuerpo, {'Idempotency-Key': clave_idempotencia})


def consultar(token, valor):
    """valor: 'status' | 'json' | 'pdf' | 'xml'."""
    return _peticion('GET', f"/document/{token}/{valor}")


def contribuyente(rut):
    """Ficha del SII de un RUT (razón social, giro, dirección...). Todo null si no existe."""
    return _peticion('GET', f"/taxpayer/{rut}")


def organizacion():
    """Datos del emisor dueño de la API key (sirve para verificar la configuración)."""
    return _peticion('GET', '/organization')
