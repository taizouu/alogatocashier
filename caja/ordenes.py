"""
Registro de las ventas de la caja como órdenes en Shopify.

Cada producto va con su precio normal y, si tuvo promoción, con una nota en la
línea. El ahorro total va como un descuento fijo de la orden (Shopify admite un
solo descuento por orden). Así el total de la orden en Shopify es exactamente
lo que se cobró, y los reportes muestran ventas brutas, descuentos y el medio
de pago (gateway de la transacción).

`construir_orden` es Python puro para poder probarlo sin Shopify:
    python -m unittest caja.tests_ordenes
"""

MEDIOS_DE_PAGO = {
    'EFECTIVO': 'Efectivo',
    'TARJETA_TUU': 'Tarjeta TUU',
    'TRANSFERENCIA': 'Transferencia',
}

MUTATION_CREAR_ORDEN = """
mutation ($order: OrderCreateOrderInput!, $options: OrderCreateOptionsInput) {
  orderCreate(order: $order, options: $options) {
    order { id name }
    userErrors { field message }
  }
}
"""


def _dinero(monto, moneda):
    return {"shopMoney": {"amount": str(int(monto)), "currencyCode": moneda}}


def _gid_variante(id_shopify):
    id_texto = str(id_shopify)
    if id_texto.startswith('gid://'):
        return id_texto
    return f"gid://shopify/ProductVariant/{id_texto.split('/')[-1]}"


def construir_orden(venta_id, total, metodo_pago, detalles, moneda='CLP'):
    """
    Arma las variables de la mutación orderCreate.

    detalles: lista de dicts con id_shopify, cantidad, precio_unitario,
              total_linea y promocion (como los recibe ProcesarVentaView).
    """
    lineas, total_normal, promociones = [], 0, []
    for d in detalles:
        cantidad = int(d['cantidad'])
        precio = int(d['precio_unitario'])
        total_normal += precio * cantidad
        linea = {
            "variantId": _gid_variante(d['id_shopify']),
            "quantity": cantidad,
            "priceSet": _dinero(precio, moneda),
        }
        promo = (d.get('promocion') or '').strip()
        if promo:
            linea["properties"] = [{"name": "Promoción", "value": promo}]
            for nombre in promo.split(' + '):
                if nombre not in promociones:
                    promociones.append(nombre)
        lineas.append(linea)

    total = int(total)
    descuento = total_normal - total
    if descuento < 0:
        raise ValueError(f"El total cobrado (${total}) supera el precio normal (${total_normal}).")

    orden = {
        "currency": moneda,
        "lineItems": lineas,
        "transactions": [{
            "kind": "SALE",
            "status": "SUCCESS",
            "gateway": MEDIOS_DE_PAGO.get(metodo_pago, metodo_pago),
            "amountSet": _dinero(total, moneda),
        }],
        "fulfillmentStatus": "FULFILLED",
        "tags": ["POS_Local", metodo_pago],
        "note": f"Venta caja local #{venta_id}",
        "sourceIdentifier": f"pos-local-{venta_id}",
    }
    if descuento > 0:
        codigo = 'Promoción caja: ' + (' + '.join(promociones) if promociones else 'descuento')
        orden["discountCode"] = {
            "itemFixedDiscountCode": {"code": codigo[:255], "amountSet": _dinero(descuento, moneda)}
        }

    # BYPASS: el stock lo descuenta la vista en la ubicación de la tienda física
    return {"order": orden, "options": {"inventoryBehaviour": "BYPASS", "sendReceipt": False}}


def crear_orden(variables):
    """Envía la orden a Shopify. Devuelve el id de la orden o lanza excepción."""
    import requests
    from django.conf import settings
    from .shopify import obtener_token_temporal

    url = (f"https://{settings.SHOPIFY_STORE_URL}/admin/api/"
           f"{settings.SHOPIFY_API_VERSION}/graphql.json")
    respuesta = requests.post(
        url, timeout=30,
        headers={"X-Shopify-Access-Token": obtener_token_temporal()},
        json={"query": MUTATION_CREAR_ORDEN, "variables": variables},
    )
    respuesta.raise_for_status()
    datos = respuesta.json()
    if datos.get('errors'):
        raise Exception('; '.join(e.get('message', str(e)) for e in datos['errors']))
    resultado = datos['data']['orderCreate']
    if resultado['userErrors']:
        raise Exception('; '.join(e['message'] for e in resultado['userErrors']))
    return resultado['order']['id']
