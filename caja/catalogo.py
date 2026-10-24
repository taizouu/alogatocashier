"""
Copia en memoria del catálogo de Shopify para el buscador de la caja.

El catálogo es pequeño (~1.500 variantes), así que lo descargamos completo y
buscamos en nuestro servidor (ver busqueda.py). Ventajas frente a consultar
Shopify en cada tecla: se busca en todos los campos, sin tildes, con orden por
relevancia y en milisegundos.

Renovación: la copia dura VIGENCIA_SEGUNDOS. Cuando vence, la siguiente
búsqueda responde con la copia anterior y se descarga una nueva en segundo
plano, así nadie espera. Solo la primera búsqueda tras iniciar el servidor
espera la descarga (unos segundos).

Se usa `requests` directamente y no la librería `shopify`, porque esta última
guarda la sesión de forma global y no es segura entre hilos.
"""
import logging
import threading
import time

import requests
from django.conf import settings

from .busqueda import buscar, preparar, productos_por_tipo
from .shopify import obtener_token_temporal

logger = logging.getLogger(__name__)

VIGENCIA_SEGUNDOS = 5 * 60
ESPERA_REINTENTO_SEGUNDOS = 60
MAX_PAGINAS = 40  # tope de seguridad: 40 x 250 = 10.000 variantes

QUERY_CATALOGO = """
query ($cursor: String) {
  productVariants(first: 250, after: $cursor) {
    pageInfo { hasNextPage endCursor }
    edges {
      node {
        id title sku barcode price inventoryQuantity
        product { title vendor productType tags status featuredMedia { preview { image { url } } } }
      }
    }
  }
}
"""


def _formatear(nodo):
    """Variante de Shopify -> formato que usa la caja (igual que el resto de la API)."""
    producto = nodo['product']
    variante = '' if nodo['title'] == 'Default Title' else nodo['title']
    return {
        "id_shopify": nodo['id'],
        "sku": nodo.get('sku') or '',
        "codigo_barras": nodo.get('barcode') or '',
        "titulo": producto['title'],
        "nombre": f"{producto['title']} - {variante}" if variante else producto['title'],
        "variante": variante,
        "precio": int(float(nodo['price'])),
        "stock_disponible": nodo.get('inventoryQuantity') or 0,
        "proveedor": producto.get('vendor') or '',
        "tipo": producto.get('productType') or '',
        "etiquetas": producto.get('tags') or [],
        "imagen": (((producto.get('featuredMedia') or {}).get('preview') or {}).get('image') or {}).get('url') or '',
    }


def descargar_catalogo():
    """Descarga todas las variantes de productos no archivados."""
    url = (f"https://{settings.SHOPIFY_STORE_URL}/admin/api/"
           f"{settings.SHOPIFY_API_VERSION}/graphql.json")
    cabeceras = {"X-Shopify-Access-Token": obtener_token_temporal()}
    items, cursor = [], None

    for _ in range(MAX_PAGINAS):
        respuesta = requests.post(url, headers=cabeceras, timeout=30,
                                  json={"query": QUERY_CATALOGO, "variables": {"cursor": cursor}})
        respuesta.raise_for_status()
        datos = respuesta.json()
        if datos.get('errors'):
            raise Exception('; '.join(e.get('message', str(e)) for e in datos['errors']))

        bloque = datos['data']['productVariants']
        items.extend(_formatear(e['node']) for e in bloque['edges']
                     if e['node']['product'].get('status') != 'ARCHIVED')
        if not bloque['pageInfo']['hasNextPage']:
            return items
        cursor = bloque['pageInfo']['endCursor']

    logger.warning("Catálogo truncado en %s páginas", MAX_PAGINAS)
    return items


class CatalogoEnMemoria:
    def __init__(self):
        self._indice = None          # lista de elementos de busqueda.preparar
        self._descargado_en = 0.0
        self._lock = threading.Lock()
        self._renovando = False

    def _renovar(self):
        """Descarga el catálogo y reemplaza el índice. Solo un hilo a la vez."""
        try:
            inicio = time.monotonic()
            items = descargar_catalogo()
            indice = [preparar(i) for i in items]
            with self._lock:
                self._indice = indice
                self._descargado_en = time.monotonic()
            logger.info("Catálogo actualizado: %s variantes en %.1f s",
                        len(indice), time.monotonic() - inicio)
        finally:
            with self._lock:
                self._renovando = False

    def _obtener_indice(self):
        with self._lock:
            vigente = self._indice is not None and \
                time.monotonic() - self._descargado_en < VIGENCIA_SEGUNDOS
            if vigente:
                return self._indice
            primera_vez = self._indice is None
            lanzar = not self._renovando
            if lanzar:
                self._renovando = True

        if primera_vez:
            if lanzar:
                self._renovar()          # sin copia previa: hay que esperar
            else:
                # Otro hilo ya está descargando: esperamos a que termine
                for _ in range(300):
                    time.sleep(0.1)
                    with self._lock:
                        if self._indice is not None or not self._renovando:
                            break
            with self._lock:
                if self._indice is None:
                    raise Exception("No se pudo descargar el catálogo de Shopify.")
                return self._indice

        # Hay una copia vencida: la usamos y renovamos en segundo plano
        if lanzar:
            threading.Thread(target=self._renovar_en_segundo_plano, daemon=True).start()
        with self._lock:
            return self._indice

    def _renovar_en_segundo_plano(self):
        try:
            self._renovar()
        except Exception:
            logger.exception("Falló la renovación del catálogo; se sigue usando la copia anterior")
            # Reintentamos en 1 minuto, no en cada búsqueda (la caja busca al escribir)
            with self._lock:
                self._descargado_en = time.monotonic() - VIGENCIA_SEGUNDOS + ESPERA_REINTENTO_SEGUNDOS

    def por_tipo(self, tipos):
        """Productos cuyo tipo de Shopify es uno de `tipos` (ver busqueda.productos_por_tipo)."""
        return productos_por_tipo([e['item'] for e in self._obtener_indice()], tipos)

    def buscar(self, consulta, limite=40):
        return buscar(self._obtener_indice(), consulta, limite)

    def buscar_variante(self, codigo_barras='', sku=''):
        """id de la variante con ese código o SKU exacto (para ventas antiguas sin variante)."""
        for entrada in self._obtener_indice():
            item = entrada['item']
            if (codigo_barras and item['codigo_barras'] == codigo_barras) or (sku and item['sku'] == sku):
                return item['id_shopify']
        return None

    def invalidar(self):
        """Marca la copia como vencida (ej: tras asociar un código de barras)."""
        with self._lock:
            self._descargado_en = 0.0


catalogo = CatalogoEnMemoria()
