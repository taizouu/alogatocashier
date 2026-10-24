"""
Pruebas de los cálculos de devoluciones. No necesitan Django ni Shopify:
    python -m unittest caja.tests_devoluciones -v
"""
import unittest

from caja.reembolsos import (DevolucionInvalida, cobrado_por_linea, construir_reembolso,
                             monto_a_reembolsar)


class MontoAReembolsarTests(unittest.TestCase):

    def test_sin_promocion_es_el_precio(self):
        # 2 latas a $3.600, se devuelve 1
        self.assertEqual(monto_a_reembolsar(7200, 2, 0, 0, 1), 3600)

    def test_con_promocion_se_reembolsa_lo_pagado(self):
        # 3 Motta cobradas $10.000 por promo: se devuelve 1
        self.assertEqual(monto_a_reembolsar(10000, 3, 0, 0, 1), 3333)

    def test_devoluciones_sucesivas_suman_exacto_lo_cobrado(self):
        # Devolver de a una las 3 latas debe sumar exactamente $10.000
        montos, devueltas, reembolsado = [], 0, 0
        for _ in range(3):
            m = monto_a_reembolsar(10000, 3, devueltas, reembolsado, 1)
            montos.append(m)
            devueltas += 1
            reembolsado += m
        self.assertEqual(sum(montos), 10000)
        self.assertEqual(montos, [3333, 3334, 3333])

    def test_devolver_todo_lo_que_queda(self):
        self.assertEqual(monto_a_reembolsar(10000, 3, 1, 3333, 2), 6667)

    def test_no_se_puede_devolver_de_mas(self):
        with self.assertRaises(DevolucionInvalida):
            monto_a_reembolsar(7200, 2, 0, 0, 3)
        with self.assertRaises(DevolucionInvalida):
            monto_a_reembolsar(7200, 2, 2, 7200, 1)
        with self.assertRaises(DevolucionInvalida):
            monto_a_reembolsar(7200, 2, 0, 0, 0)


class CobradoPorLineaTests(unittest.TestCase):

    def test_venta_nueva_usa_lo_guardado(self):
        self.assertEqual(cobrado_por_linea(15000, [(6135, 10800), (2275, 4000), (6590, 11600)]),
                         [6135, 2275, 6590])

    def test_venta_antigua_con_promocion_no_reembolsa_precio_de_lista(self):
        # Caso de la revisión: "3 latas por $10.000" con latas a $4.000, sin total_linea guardado
        self.assertEqual(cobrado_por_linea(10000, [(None, 12000)]), [10000])

    def test_venta_antigua_repartida_en_proporcion(self):
        # Total real $15.000 con precios normales $10.800 + $4.000 + $11.600 = $26.400
        partes = cobrado_por_linea(15000, [(None, 10800), (None, 4000), (None, 11600)])
        self.assertEqual(sum(partes), 15000)
        self.assertEqual(partes, [6136, 2273, 6591])

    def test_venta_antigua_sin_promocion(self):
        self.assertEqual(cobrado_por_linea(7200, [(None, 7200)]), [7200])


ORDEN = {
    'id': 'gid://shopify/Order/1',
    'lineItems': {'nodes': [
        {'id': 'gid://shopify/LineItem/10', 'refundableQuantity': 3, 'variant': {'id': 'gid://shopify/ProductVariant/100'}},
        {'id': 'gid://shopify/LineItem/11', 'refundableQuantity': 2, 'variant': {'id': 'gid://shopify/ProductVariant/200'}},
    ]},
    'transactions': [
        {'id': 'gid://shopify/OrderTransaction/9', 'kind': 'SALE', 'status': 'SUCCESS', 'gateway': 'Efectivo'},
    ],
}


class ReembolsoShopifyTests(unittest.TestCase):

    def test_devolucion_con_reposicion_y_dinero(self):
        entrada, aviso = construir_reembolso(
            ORDEN, [{'variant_id': 'gid://shopify/ProductVariant/100', 'cantidad': 2}],
            6667, 'EFECTIVO', True, '555', 'Devolución #1')
        self.assertIsNone(aviso)
        self.assertEqual(entrada['refundLineItems'], [{
            'lineItemId': 'gid://shopify/LineItem/10', 'quantity': 2,
            'restockType': 'RETURN', 'locationId': 'gid://shopify/Location/555',
        }])
        t = entrada['transactions'][0]
        self.assertEqual((t['kind'], t['amount'], t['parentId'], t['gateway']),
                         ('REFUND', '6667', 'gid://shopify/OrderTransaction/9', 'Efectivo'))

    def test_sin_reponer_stock(self):
        entrada, _ = construir_reembolso(ORDEN, [{'variant_id': '200', 'cantidad': 1}],
                                         5000, 'EFECTIVO', False, '555', 'x')
        self.assertEqual(entrada['refundLineItems'][0]['restockType'], 'NO_RESTOCK')
        self.assertNotIn('locationId', entrada['refundLineItems'][0])

    def test_orden_antigua_sin_pago_registrado(self):
        orden = {**ORDEN, 'transactions': []}
        entrada, aviso = construir_reembolso(orden, [{'variant_id': '100', 'cantidad': 1}],
                                             3600, 'EFECTIVO', True, '555', 'x')
        self.assertNotIn('transactions', entrada)
        self.assertIn('no tiene un pago registrado', aviso)

    def test_mas_unidades_que_las_disponibles_en_shopify(self):
        with self.assertRaises(DevolucionInvalida):
            construir_reembolso(ORDEN, [{'variant_id': '200', 'cantidad': 3}],
                                1, 'EFECTIVO', True, '555', 'x')

    def test_variante_repartida_en_dos_lineas(self):
        orden = {**ORDEN, 'lineItems': {'nodes': [
            {'id': 'L1', 'refundableQuantity': 1, 'variant': {'id': 'gid://shopify/ProductVariant/100'}},
            {'id': 'L2', 'refundableQuantity': 2, 'variant': {'id': 'gid://shopify/ProductVariant/100'}},
        ]}}
        entrada, _ = construir_reembolso(orden, [{'variant_id': '100', 'cantidad': 3}],
                                         9000, 'EFECTIVO', True, '555', 'x')
        self.assertEqual([(l['lineItemId'], l['quantity']) for l in entrada['refundLineItems']],
                         [('L1', 1), ('L2', 2)])


if __name__ == '__main__':
    unittest.main()
