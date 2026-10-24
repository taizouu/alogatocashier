"""
Pruebas de los rangos de fecha del historial. No necesitan Django:
    python -m unittest caja.tests_historial -v
"""
import unittest
from datetime import date, datetime, timezone

from caja.fechas import RangoInvalido, rango_del_dia

UTC = timezone.utc


class RangoFechasTests(unittest.TestCase):

    def test_sin_fechas_es_hoy(self):
        inicio, fin = rango_del_dia(hoy=date(2026, 10, 24))
        self.assertEqual(inicio.date(), date(2026, 10, 24))
        self.assertEqual(fin.date(), date(2026, 10, 25))

    def test_venta_a_las_22_es_del_mismo_dia_en_chile(self):
        # 24-oct 22:00 en Chile (horario de verano, UTC-3) = 25-oct 01:00 UTC
        venta_utc = datetime(2026, 10, 25, 1, 0, tzinfo=UTC)
        inicio, fin = rango_del_dia('2026-10-24')
        self.assertTrue(inicio <= venta_utc < fin)
        inicio_25, _ = rango_del_dia('2026-10-25')
        self.assertFalse(inicio_25 <= venta_utc)

    def test_dia_en_utc_con_horario_de_invierno(self):
        # En julio Chile está en UTC-4: el día empieza a las 04:00 UTC
        inicio, _ = rango_del_dia('2026-07-15')
        self.assertEqual(inicio.astimezone(UTC), datetime(2026, 7, 15, 4, 0, tzinfo=UTC))

    def test_rango_de_varios_dias_incluye_ambos_extremos(self):
        inicio, fin = rango_del_dia('2026-10-01', '2026-10-31')
        self.assertEqual(inicio.date(), date(2026, 10, 1))
        self.assertEqual(fin.date(), date(2026, 11, 1))

    def test_errores(self):
        with self.assertRaises(RangoInvalido):
            rango_del_dia('2026-10-31', '2026-10-01')      # hasta antes que desde
        with self.assertRaises(RangoInvalido):
            rango_del_dia('24/10/2026')                    # formato incorrecto
        with self.assertRaises(RangoInvalido):
            rango_del_dia('2024-01-01', '2026-01-01')      # más de un año


if __name__ == '__main__':
    unittest.main()
