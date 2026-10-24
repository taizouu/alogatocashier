"""
Rangos de fechas en la hora de Chile para filtrar ventas.

Las fechas se guardan en UTC. "Ventas del 24 de octubre" significa desde las
00:00 hasta las 23:59 de ese día en Chile, que en UTC es otro rango (y cambia
con el horario de verano). Este módulo hace esa conversión.

Python puro para poder probarlo solo:  python -m unittest caja.tests_historial
"""
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

ZONA_TIENDA = ZoneInfo('America/Santiago')
MAX_DIAS = 366


class RangoInvalido(ValueError):
    pass


def _leer_fecha(texto, nombre):
    try:
        return date.fromisoformat(str(texto))
    except ValueError:
        raise RangoInvalido(f"La fecha '{nombre}' debe tener el formato AAAA-MM-DD.")


def rango_del_dia(desde=None, hasta=None, hoy=None, zona=ZONA_TIENDA):
    """
    Convierte 'desde' y 'hasta' (AAAA-MM-DD, ambos incluidos) en un rango
    [inicio, fin) de datetimes con zona horaria. Sin fechas: el día de hoy.
    """
    hoy = hoy or datetime.now(zona).date()
    dia_desde = _leer_fecha(desde, 'desde') if desde else hoy
    dia_hasta = _leer_fecha(hasta, 'hasta') if hasta else dia_desde

    if dia_hasta < dia_desde:
        raise RangoInvalido("La fecha 'hasta' no puede ser anterior a 'desde'.")
    if (dia_hasta - dia_desde).days >= MAX_DIAS:
        raise RangoInvalido("El rango no puede superar un año.")

    inicio = datetime.combine(dia_desde, time.min, tzinfo=zona)
    fin = datetime.combine(dia_hasta + timedelta(days=1), time.min, tzinfo=zona)
    return inicio, fin
