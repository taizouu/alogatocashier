"""
Pruebas de cómo se arma la orden de Shopify. No necesitan Django ni Shopify:
    python -m unittest caja.tests_ordenes -v
"""
import unittest

from caja.ordenes import construir_orden


def linea(id_shopify, cantidad, precio, total_linea=None, promocion=''):
    return {'id_shopify': id_shopify, 'cantidad': cantidad, 'precio_unitario': precio,
            'total_linea': precio * cantidad if total_linea is None else total_linea,
            'promocion': promocion}


class OrdenShopifyTests(unittest.TestCase):

    def test_venta_sin_promocion_no_lleva_descuento(self):
        v = construir_orden(1, 7200, 'EFECTIVO', [linea('gid://shopify/ProductVariant/1', 2, 3600)])
        orden = v['order']
        self.assertNotIn('discountCode', orden)
        self.assertEqual(orden['lineItems'][0]['priceSet']['shopMoney']['amount'], '3600')
        self.assertEqual(orden['transactions'][0]['amountSet']['shopMoney']['amount'], '7200')
        self.assertEqual(orden['transactions'][0]['gateway'], 'Efectivo')

    def test_promo_octubre(self):
        # Caso real: 3 Motta ($3.600) + 2 Toro ($2.000) + 2 Loop ($5.800) = $26.400 -> $15.000
        detalles = [
            linea('m', 3, 3600, 6135, 'Promo Octubre'),
            linea('t', 2, 2000, 2275, 'Promo Octubre'),
            linea('l', 2, 5800, 6590, 'Promo Octubre'),
        ]
        orden = construir_orden(42, 15000, 'TARJETA_TUU', detalles)['order']
        descuento = orden['discountCode']['itemFixedDiscountCode']
        self.assertEqual(descuento['amountSet']['shopMoney']['amount'], '11400')
        self.assertEqual(descuento['code'], 'Promoción caja: Promo Octubre')
        self.assertEqual(orden['transactions'][0]['amountSet']['shopMoney']['amount'], '15000')
        self.assertEqual(orden['transactions'][0]['gateway'], 'Tarjeta TUU')
        # Precio normal en cada línea, con la promoción como nota
        self.assertEqual(orden['lineItems'][0]['priceSet']['shopMoney']['amount'], '3600')
        self.assertEqual(orden['lineItems'][0]['properties'], [{'name': 'Promoción', 'value': 'Promo Octubre'}])

    def test_varias_promociones_y_productos_sin_promocion(self):
        detalles = [
            linea('a', 3, 3600, 10000, '3 Motta x $10.000'),
            linea('b', 2, 5000, 8000, 'Promo B'),
            linea('c', 1, 1500),
        ]
        orden = construir_orden(7, 19500, 'EFECTIVO', detalles)['order']
        self.assertEqual(orden['discountCode']['itemFixedDiscountCode']['code'],
                         'Promoción caja: 3 Motta x $10.000 + Promo B')
        self.assertEqual(orden['discountCode']['itemFixedDiscountCode']['amountSet']['shopMoney']['amount'], '2800')
        self.assertNotIn('properties', orden['lineItems'][2])

    def test_id_numerico_se_convierte_a_gid(self):
        orden = construir_orden(1, 100, 'EFECTIVO', [linea('12345', 1, 100)])['order']
        self.assertEqual(orden['lineItems'][0]['variantId'], 'gid://shopify/ProductVariant/12345')

    def test_no_descuenta_stock_ni_envia_correo(self):
        opciones = construir_orden(1, 100, 'EFECTIVO', [linea('x', 1, 100)])['options']
        self.assertEqual(opciones, {'inventoryBehaviour': 'BYPASS', 'sendReceipt': False})

    def test_total_mayor_al_normal_es_error(self):
        with self.assertRaises(ValueError):
            construir_orden(1, 999, 'EFECTIVO', [linea('x', 1, 100)])

    def test_identificador_de_la_venta(self):
        orden = construir_orden(88, 100, 'TRANSFERENCIA', [linea('x', 1, 100)])['order']
        self.assertEqual(orden['sourceIdentifier'], 'pos-local-88')
        self.assertEqual(orden['tags'], ['POS_Local', 'TRANSFERENCIA'])
        self.assertEqual(orden['transactions'][0]['gateway'], 'Transferencia')


if __name__ == '__main__':
    unittest.main()
