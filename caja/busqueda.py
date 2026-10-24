"""
Búsqueda de productos sobre el catálogo en memoria.

Los títulos de la tienda están optimizados para SEO y no siguen un patrón
fijo: "ACRÍLICO STD 250 ML" es de la marca Krack, pero "Krack" no aparece en
el título. Por eso no basta con buscar en el título: cada palabra escrita se
busca en todos los campos (marca, tipo, título, variante/color, etiquetas,
SKU y código de barras) y un producto aparece solo si TODAS las palabras
coinciden con algún campo. Así "krack limonada" o "acrilico 250" funcionan.

Este módulo es Python puro (sin Django ni Shopify) para poder probarlo solo:
    python -m unittest caja.tests_busqueda
"""
import re
import unicodedata

# Campos en los que se busca y su peso en el orden de los resultados.
# Un código exacto es lo más específico; las etiquetas, lo menos.
PESOS = {
    'sku': 5,
    'codigo_barras': 5,
    'proveedor': 4,
    'titulo': 3,
    'variante': 3,
    'tipo': 2,
    'etiquetas': 1,
}

# Una palabra corta ("ml", "4") solo cuenta si coincide con una palabra
# completa o con su comienzo; dentro de otra palabra generaría ruido.
LARGO_MINIMO_SUBCADENA = 3


def normalizar(texto):
    """Minúsculas, sin tildes y con cualquier separador como espacio."""
    texto = unicodedata.normalize('NFD', str(texto or ''))
    texto = ''.join(c for c in texto if unicodedata.category(c) != 'Mn')
    return re.sub(r'[^a-z0-9]+', ' ', texto.lower()).strip()


def preparar(item):
    """
    Precalcula los textos normalizados de un producto del catálogo para que
    cada búsqueda no tenga que hacerlo de nuevo.
    `item` tiene el formato que entrega la API a la caja (ver catalogo.py).
    """
    campos = {
        'sku': item.get('sku') or '',
        'codigo_barras': item.get('codigo_barras') or '',
        'proveedor': item.get('proveedor') or '',
        'titulo': item.get('titulo') or item.get('nombre') or '',
        'variante': item.get('variante') or '',
        'tipo': item.get('tipo') or '',
        'etiquetas': ' '.join(item.get('etiquetas') or []),
    }
    normalizados = {}
    for campo, valor in campos.items():
        texto = normalizar(valor)
        normalizados[campo] = (texto, texto.split())
    return {
        'item': item,
        'campos': normalizados,
        'nombre_normalizado': normalizar(item.get('nombre')),
    }


def _puntaje_palabra(palabra, campos):
    """Mejor puntaje de una palabra buscada entre todos los campos (0 = no aparece)."""
    mejor = 0
    for campo, (texto, palabras) in campos.items():
        if not texto:
            continue
        peso = PESOS[campo]
        if palabra in palabras:
            puntaje = peso * 3          # palabra completa
        elif any(p.startswith(palabra) for p in palabras):
            puntaje = peso * 2          # comienzo de palabra ("acri" -> "acrilico")
        elif len(palabra) >= LARGO_MINIMO_SUBCADENA and palabra in texto:
            puntaje = peso              # dentro de una palabra
        else:
            continue
        mejor = max(mejor, puntaje)
    return mejor


def productos_por_tipo(items, tipos):
    """
    Productos cuyo tipo de Shopify coincide con alguno de `tipos` (sin
    importar mayúsculas ni tildes), ordenados por nombre. Se usa en los
    accesos rápidos de la caja (Caps, Puntas).
    """
    buscados = {normalizar(t) for t in tipos}
    elegidos = [i for i in items if normalizar(i.get('tipo')) in buscados]
    return sorted(elegidos, key=lambda i: normalizar(i.get('nombre')))


def buscar(indice, consulta, limite=40):
    """
    Busca `consulta` en el índice (lista de elementos de `preparar`).
    Devuelve los productos ordenados de más a menos relevante.
    """
    palabras = normalizar(consulta).split()
    if not palabras:
        return []
    frase = ' '.join(palabras)

    encontrados = []
    for entrada in indice:
        total = 0
        for palabra in palabras:
            puntaje = _puntaje_palabra(palabra, entrada['campos'])
            if puntaje == 0:
                break               # todas las palabras deben aparecer
            total += puntaje
        else:
            # Premio si la frase completa aparece tal cual en el nombre
            if len(palabras) > 1 and frase in entrada['nombre_normalizado']:
                total += 5
            encontrados.append((total, entrada['nombre_normalizado'], entrada['item']))

    encontrados.sort(key=lambda r: (-r[0], r[1]))
    return [item for _, _, item in encontrados[:limite]]
