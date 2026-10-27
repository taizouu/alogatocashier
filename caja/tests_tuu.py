"""Pruebas del cliente de Pago remoto TUU (sin Django): python -m unittest caja.tests_tuu"""
import unittest

from caja.tuu import construir_solicitud, estado_desde, interpretar


class Estados(unittest.TestCase):
    def test_texto_y_numero(self):
        self.assertEqual(estado_desde('Completed'), 'COMPLETADO')
        self.assertEqual(estado_desde(5), 'COMPLETADO')
        self.assertEqual(estado_desde('Sent'), 'ENVIADO')
        self.assertEqual(estado_desde('1'), 'ENVIADO')
        self.assertEqual(estado_desde('canceled'), 'CANCELADO')
        self.assertEqual(estado_desde(4), 'FALLIDO')
        self.assertEqual(estado_desde(0), 'PENDIENTE')
        self.assertEqual(estado_desde('Processing'), 'PROCESANDO')

    def test_desconocido(self):
        self.assertIsNone(estado_desde('Raro'))
        self.assertIsNone(estado_desde(None))


class Interpretar(unittest.TestCase):
    def test_respuesta_completa(self):
        datos = {"idempotencyKey": "p1", "status": "Completed", "sequenceNumber": "000000051934",
                 "amount": 1600, "device": "TJ44245N20448", "dteType": 48}
        self.assertEqual(interpretar(datos), ('COMPLETADO', '000000051934', 1600))

    def test_respuesta_minima(self):
        self.assertEqual(interpretar({"status": "Pending"}), ('PENDIENTE', '', None))
        self.assertEqual(interpretar({}), (None, '', None))
        self.assertEqual(interpretar(None), (None, '', None))


class Solicitud(unittest.TestCase):
    def test_cuerpo(self):
        cuerpo = construir_solicitud('abc', 15990, 'DEBITO', 'TJ44246421916', 'Venta AloGato', 0)
        self.assertEqual(cuerpo['amount'], 15990)
        self.assertEqual(cuerpo['paymentMethod'], 2)
        self.assertEqual(cuerpo['device'], 'TJ44246421916')
        self.assertEqual(cuerpo['idempotencyKey'], 'abc')
        self.assertEqual(cuerpo['dteType'], 0)
        self.assertEqual(construir_solicitud('abc', 1000, 'CREDITO', 'X')['paymentMethod'], 1)

    def test_limites(self):
        with self.assertRaises(ValueError):
            construir_solicitud('abc', 99, 'DEBITO', 'X')
        with self.assertRaises(ValueError):
            construir_solicitud('abc', 100_000_000, 'DEBITO', 'X')
        with self.assertRaises(ValueError):
            construir_solicitud('abc', 1000, 'PREPAGO', 'X')
        with self.assertRaises(ValueError):
            construir_solicitud('abc', 1000, 'DEBITO', '')
        with self.assertRaises(ValueError):
            construir_solicitud('x' * 37, 1000, 'DEBITO', 'X')

    def test_descripcion_solo_ascii(self):
        self.assertEqual(construir_solicitud('a', 1000, 'DEBITO', 'X', 'Café ñandú')['description'], 'Caf and')


if __name__ == '__main__':
    unittest.main()
