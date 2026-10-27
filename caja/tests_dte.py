"""
Pruebas del armado de boletas y facturas. No necesitan Django ni red:
    python -m unittest caja.tests_dte -v
"""
import unittest
from datetime import date

from caja.dte import (BOLETA, FACTURA, DocumentoInvalido, construir_boleta, construir_factura,
                      iva_de, leer_pedido, neto_desde_total, normalizar_rut)

# Emisor demo publicado por OpenFactura para su ambiente de pruebas
EMISOR = {
    'rut': '76795561-8', 'razon_social': 'HAULMER SPA',
    'giro': 'VENTA AL POR MENOR EN EMPRESAS DE VENTA A DISTANCIA VIA INTERNET',
    'acteco': 479100, 'direccion': 'ARTURO PRAT 527 CURICO', 'comuna': 'Curicó', 'sucursal': '81303347',
}
RECEPTOR = {'rut': '76.430.498-5', 'razon_social': 'HOSTY SPA', 'giro': 'ACTIVIDADES DE CONSULTORIA DE INFORMATICA Y GESTION',
            'direccion': 'ARTURO PRAT 527', 'comuna': 'Curicó', 'email': 'cliente@ejemplo.cl'}

# Caso real "Promo Octubre": $26.400 normal -> $15.000 cobrado
PROMO_OCTUBRE = [
    {'nombre': 'Spray Motta Naranja Greda 400 ml – Pintura para graffiti', 'cantidad': 3, 'total': 6135},
    {'nombre': 'Toro Cromado', 'cantidad': 2, 'total': 2275},
    {'nombre': 'Spray Loop 109 Sevilla 400 ml – Pintura para graffiti', 'cantidad': 2, 'total': 6590},
]


class RutTests(unittest.TestCase):

    def test_formatos_validos(self):
        self.assertEqual(normalizar_rut('76.430.498-5'), '76430498-5')
        self.assertEqual(normalizar_rut('764304985'), '76430498-5')
        self.assertEqual(normalizar_rut('66666666-6'), '66666666-6')

    def test_digito_k(self):
        self.assertEqual(normalizar_rut('10.000.013-k'), '10000013-K')

    def test_invalidos(self):
        for malo in ('76430498-4', '', 'abc', '1'):
            with self.assertRaises(DocumentoInvalido):
                normalizar_rut(malo)


class MontosTests(unittest.TestCase):

    def test_iva_redondeado(self):
        self.assertEqual(iva_de(12605), 2395)   # 2394,95 -> 2395
        self.assertEqual(iva_de(100), 19)

    def test_neto_desde_total_exacto(self):
        neto, iva, dif = neto_desde_total(15000)
        self.assertEqual((neto + iva, dif), (15000, 0))
        self.assertEqual(iva, iva_de(neto))

    def test_total_inalcanzable_queda_a_un_peso(self):
        # Hay totales que ningún neto alcanza por el redondeo del IVA
        inalcanzables = [t for t in range(1, 5000) if neto_desde_total(t)[2] != 0]
        self.assertTrue(inalcanzables)
        for t in inalcanzables:
            self.assertEqual(abs(neto_desde_total(t)[2]), 1, t)

    def test_neto_siempre_cuadra_con_su_iva(self):
        for t in range(1, 20000, 7):
            neto, iva, dif = neto_desde_total(t)
            self.assertEqual(iva, iva_de(neto))
            self.assertLessEqual(abs(dif), 1)


class BoletaTests(unittest.TestCase):

    def setUp(self):
        self.dte = construir_boleta(PROMO_OCTUBRE, EMISOR, 'EFECTIVO', fecha=date(2026, 10, 27))
        self.enc = self.dte['Encabezado']

    def test_encabezado(self):
        self.assertEqual(self.enc['IdDoc'], {'TipoDTE': BOLETA, 'Folio': 0, 'FchEmis': '2026-10-27',
                                             'IndServicio': 3, 'MedioPago': 1})
        self.assertEqual(self.enc['Receptor'], {'RUTRecep': '66666666-6'})
        self.assertIn('RznSocEmisor', self.enc['Emisor'])
        self.assertNotIn('Acteco', self.enc['Emisor'])

    def test_totales_brutos_y_neto_mas_iva(self):
        t = self.enc['Totales']
        self.assertEqual(t['MntTotal'], 15000)
        self.assertEqual(t['MntNeto'] + t['IVA'], 15000)
        self.assertEqual(t['MntNeto'], 12605)
        self.assertNotIn('TasaIVA', t)
        self.assertEqual(sum(d['MontoItem'] for d in self.dte['Detalle']), 15000)

    def test_detalle_con_lo_cobrado(self):
        primera = self.dte['Detalle'][0]
        self.assertEqual((primera['QtyItem'], primera['PrcItem'], primera['MontoItem']), (3, 2045, 6135))
        self.assertNotIn('–', primera['NmbItem'])
        for d in self.dte['Detalle']:
            self.assertEqual(round(d['QtyItem'] * d['PrcItem']), d['MontoItem'])

    def test_precio_con_decimales_cuadra(self):
        dte = construir_boleta([{'nombre': '3 Motta promo', 'cantidad': 3, 'total': 10000}], EMISOR, 'TRANSFERENCIA')
        d = dte['Detalle'][0]
        self.assertEqual(d['PrcItem'], 3333.333333)
        self.assertEqual(round(d['QtyItem'] * d['PrcItem']), 10000)
        self.assertEqual(dte['Encabezado']['IdDoc']['MedioPago'], 3)

    def test_lineas_en_cero_no_van_y_venta_vacia_es_error(self):
        dte = construir_boleta([{'nombre': 'a', 'cantidad': 1, 'total': 500},
                                {'nombre': 'regalo', 'cantidad': 1, 'total': 0}], EMISOR, 'EFECTIVO')
        self.assertEqual(len(dte['Detalle']), 1)
        with self.assertRaises(DocumentoInvalido):
            construir_boleta([{'nombre': 'regalo', 'cantidad': 1, 'total': 0}], EMISOR, 'EFECTIVO')

    def test_nombre_largo_se_corta(self):
        dte = construir_boleta([{'nombre': 'x' * 120, 'cantidad': 1, 'total': 100}], EMISOR, 'EFECTIVO')
        self.assertEqual(len(dte['Detalle'][0]['NmbItem']), 80)


class FacturaTests(unittest.TestCase):

    def test_factura_promo_octubre(self):
        dte, dif = construir_factura(PROMO_OCTUBRE, EMISOR, RECEPTOR, fecha=date(2026, 10, 27))
        enc = dte['Encabezado']
        self.assertEqual(enc['IdDoc']['TipoDTE'], FACTURA)
        self.assertEqual(enc['IdDoc']['FmaPago'], 1)
        self.assertEqual(enc['Emisor']['Acteco'], 479100)
        self.assertEqual(enc['Receptor']['RUTRecep'], '76430498-5')
        self.assertLessEqual(len(enc['Receptor']['GiroRecep']), 40)
        t = enc['Totales']
        self.assertEqual(t['TasaIVA'], '19')
        self.assertEqual(t['IVA'], iva_de(t['MntNeto']))
        self.assertEqual(t['MntTotal'], t['MntNeto'] + t['IVA'])
        self.assertEqual(t['MntTotal'] - 15000, dif)
        # El detalle va en neto y suma exactamente el neto total
        self.assertEqual(sum(d['MontoItem'] for d in dte['Detalle']), t['MntNeto'])
        for d in dte['Detalle']:
            self.assertEqual(round(d['QtyItem'] * d['PrcItem']), d['MontoItem'])

    def test_faltan_datos_del_cliente(self):
        with self.assertRaises(DocumentoInvalido):
            construir_factura(PROMO_OCTUBRE, EMISOR, {**RECEPTOR, 'giro': ''})

    def test_rut_invalido_o_generico(self):
        with self.assertRaises(DocumentoInvalido):
            construir_factura(PROMO_OCTUBRE, EMISOR, {**RECEPTOR, 'rut': '76430498-4'})
        with self.assertRaises(DocumentoInvalido):
            construir_factura(PROMO_OCTUBRE, EMISOR, {**RECEPTOR, 'rut': '66666666-6'})



class PedidoTests(unittest.TestCase):

    def test_desactivado_no_emite(self):
        self.assertIsNone(leer_pedido({'tipo': 'FACTURA'}, 'EFECTIVO', activo=False))

    def test_efectivo_boleta_por_defecto(self):
        self.assertEqual(leer_pedido(None, 'EFECTIVO', True), {'tipo': BOLETA, 'email': '', 'receptor': {}})
        self.assertEqual(leer_pedido({'email': ' a@b.cl '}, 'TRANSFERENCIA', True)['email'], 'a@b.cl')

    def test_tarjeta_no_emite_boleta_porque_la_emite_el_pos(self):
        self.assertIsNone(leer_pedido({'tipo': 'BOLETA'}, 'TARJETA_TUU', True))

    def test_tarjeta_con_factura_se_rechaza(self):
        with self.assertRaises(DocumentoInvalido):
            leer_pedido({'tipo': 'FACTURA', 'receptor': RECEPTOR}, 'TARJETA_TUU', True)

    def test_factura_valida_y_normaliza_rut(self):
        pedido = leer_pedido({'tipo': 'factura', 'receptor': RECEPTOR, 'email': 'x@y.cl'}, 'EFECTIVO', True)
        self.assertEqual(pedido['tipo'], FACTURA)
        self.assertEqual(pedido['receptor']['rut'], '76430498-5')
        self.assertEqual(pedido['receptor']['email'], 'x@y.cl')

    def test_factura_incompleta_o_con_datos_malos(self):
        for malo in ({**RECEPTOR, 'comuna': ''}, {**RECEPTOR, 'rut': '1-1'}, {**RECEPTOR, 'rut': '66.666.666-6'}):
            with self.assertRaises(DocumentoInvalido):
                leer_pedido({'tipo': 'FACTURA', 'receptor': malo}, 'EFECTIVO', True)
        with self.assertRaises(DocumentoInvalido):
            leer_pedido({'tipo': 'BOLETA', 'email': 'no-es-correo'}, 'EFECTIVO', True)
        with self.assertRaises(DocumentoInvalido):
            leer_pedido({'tipo': 'GUIA'}, 'EFECTIVO', True)

class Folio(unittest.TestCase):
    def test_formatos_de_respuesta(self):
        from caja.dte import folio_de
        self.assertEqual(folio_de({'folio': 15}), 15)
        self.assertEqual(folio_de({'json': {'Encabezado': {'IdDoc': {'Folio': '42'}}}}), 42)
        self.assertEqual(folio_de({'Encabezado': {'IdDoc': {'Folio': 7}}}), 7)
        self.assertIsNone(folio_de({}))
        self.assertIsNone(folio_de(None))


class PedidoMalformado(unittest.TestCase):
    def test_documento_no_diccionario(self):
        from caja.dte import DocumentoInvalido, leer_pedido
        with self.assertRaises(DocumentoInvalido):
            leer_pedido('BOLETA', 'EFECTIVO', True)
        with self.assertRaises(DocumentoInvalido):
            leer_pedido({'tipo': 'FACTURA', 'receptor': 'x'}, 'EFECTIVO', True)


if __name__ == '__main__':
    unittest.main()
