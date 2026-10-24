"""
Cálculos de devoluciones. Python puro (sin Django ni Shopify) para probarlo:
    python -m unittest caja.tests_devoluciones -v

Monto a reembolsar: lo que el cliente pagó realmente por esas unidades. Si una
línea de 3 latas se cobró $10.000 por una promoción, cada lata devuelta
reembolsa ~$3.333, no su precio de lista. La última unidad devuelta de una
línea reembolsa exactamente lo que queda, así la suma de todas las
devoluciones nunca supera ni queda corta respecto de lo cobrado.
"""
from .ordenes import MEDIOS_DE_PAGO


class DevolucionInvalida(ValueError):
    pass


def monto_a_reembolsar(total_cobrado, cantidad_vendida, unidades_ya_devueltas,
                       monto_ya_reembolsado, cantidad):
    """Reembolso por `cantidad` unidades de una línea de venta."""
    restantes = cantidad_vendida - unidades_ya_devueltas
    if cantidad < 1:
        raise DevolucionInvalida("La cantidad a devolver debe ser al menos 1.")
    if cantidad > restantes:
        raise DevolucionInvalida(
            f"Solo quedan {restantes} unidad(es) por devolver de este producto." if restantes
            else "Este producto ya fue devuelto completo.")
    dinero_restante = total_cobrado - monto_ya_reembolsado
    if cantidad == restantes:
        return dinero_restante
    # Redondeo hacia arriba en los ,5 con enteros (igual que la vista previa
    # del frontend; round() de Python redondea los ,5 al par y no coincidiría)
    return (2 * dinero_restante * cantidad + restantes) // (2 * restantes)


def cobrado_por_linea(total_venta, lineas):
    """
    Lo cobrado por cada línea. `lineas` es una lista de (total_linea, precio_normal_linea).
    Las ventas nuevas guardan total_linea. Las antiguas no (None): en ese caso se
    reparte el total real de la venta en proporción al precio normal de cada
    línea, para no reembolsar a precio de lista una venta que tuvo promoción.
    """
    if all(t is not None for t, _ in lineas):
        return [int(t) for t, _ in lineas]
    total_venta = int(total_venta)
    normal = sum(n for _, n in lineas)
    if normal <= 0:
        return [0 for _ in lineas]
    resultado, acumulado = [], 0
    for i, (_, n) in enumerate(lineas):
        if i == len(lineas) - 1:
            resultado.append(total_venta - acumulado)
        else:
            parte = (2 * total_venta * n + normal) // (2 * normal)
            resultado.append(parte)
            acumulado += parte
    return resultado


MUTATION_REEMBOLSO = """
mutation ($input: RefundInput!, $clave: String!) {
  refundCreate(input: $input) @idempotent(key: $clave) {
    refund { id }
    userErrors { field message }
  }
}
"""

QUERY_ORDEN = """
query ($id: ID!) {
  order(id: $id) {
    id
    lineItems(first: 100) { nodes { id refundableQuantity variant { id } } }
    transactions(first: 20) { id kind status gateway }
  }
}
"""


def _gid_variante(id_shopify):
    texto = str(id_shopify)
    return texto if texto.startswith('gid://') else f"gid://shopify/ProductVariant/{texto.split('/')[-1]}"


def construir_reembolso(orden, devueltos, total, metodo_reembolso, repone_stock,
                        location_id, nota, moneda='CLP'):
    """
    Arma el `input` de refundCreate.

    orden:     respuesta de QUERY_ORDEN (dict con lineItems y transactions)
    devueltos: lista de {'variant_id': ..., 'cantidad': n}
    Devuelve (input, aviso). `aviso` explica si el dinero no se pudo registrar.
    """
    disponibles = {}
    for linea in orden['lineItems']['nodes']:
        variante = (linea.get('variant') or {}).get('id')
        if variante:
            disponibles.setdefault(variante, []).append(
                {'id': linea['id'], 'libres': int(linea['refundableQuantity'])})

    lineas_reembolso = []
    for item in devueltos:
        variante = _gid_variante(item['variant_id'])
        pendiente = int(item['cantidad'])
        # Una variante puede estar en más de una línea de la orden: repartimos
        for linea in disponibles.get(variante, []):
            if pendiente == 0:
                break
            tomar = min(pendiente, linea['libres'])
            if tomar:
                lineas_reembolso.append({
                    'lineItemId': linea['id'],
                    'quantity': tomar,
                    'restockType': 'RETURN' if repone_stock else 'NO_RESTOCK',
                    **({'locationId': f"gid://shopify/Location/{location_id}"} if repone_stock else {}),
                })
                linea['libres'] -= tomar
                pendiente -= tomar
        if pendiente:
            raise DevolucionInvalida(
                "La orden en Shopify no tiene suficientes unidades por devolver de un producto "
                "(¿se devolvió desde Shopify?).")

    entrada = {
        'orderId': orden['id'],
        'note': nota[:255],
        'notify': False,
        'currency': moneda,
        'refundLineItems': lineas_reembolso,
    }

    # El dinero se registra contra el pago original de la orden
    pago = next((t for t in orden.get('transactions') or []
                 if t.get('kind') in ('SALE', 'CAPTURE') and t.get('status') == 'SUCCESS'), None)
    aviso = None
    if total > 0 and pago:
        entrada['transactions'] = [{
            'orderId': orden['id'],
            'parentId': pago['id'],
            'kind': 'REFUND',
            'gateway': pago.get('gateway') or MEDIOS_DE_PAGO.get(metodo_reembolso, metodo_reembolso),
            'amount': str(int(total)),
        }]
    elif total > 0:
        aviso = ("La orden en Shopify no tiene un pago registrado (venta anterior a la "
                 "actualización): se registraron los productos devueltos, pero no el monto.")
    return entrada, aviso
