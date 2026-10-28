"""
Armado de documentos tributarios electrónicos (DTE) para la API de
OpenFactura (Haulmer): boleta electrónica (39), factura electrónica (33) y
nota de crédito electrónica (61).

Python puro, sin Django ni red, para poder probarlo solo:
    python -m unittest caja.tests_dte -v

Reglas (formato SII / OpenFactura):
- Folio siempre 0: OpenFactura lo asigna.
- Boleta: Detalle con montos BRUTOS (IVA incluido), Emisor con RznSocEmisor y
  GiroEmisor (sin Acteco), Receptor genérico 66666666-6, IndServicio 3 y
  Totales sin TasaIVA.
- Factura: Detalle con montos NETOS, Emisor con RznSoc/GiroEmis/Acteco,
  Receptor completo y Totales con TasaIVA "19".
- Nota de crédito: mismo formato que la factura (montos netos), con el
  documento original en "Referencia". CodRef 1 = anula el documento completo;
  CodRef 3 = corrige montos (devolución parcial). Si el original es una
  boleta, el receptor es el genérico 66666666-6.
- Los precios de la caja ya incluyen IVA y las promociones están repartidas
  por línea (total cobrado por línea), así que cada línea del documento usa lo
  realmente cobrado.
"""
from datetime import date
from decimal import ROUND_HALF_UP, Decimal

BOLETA = 39
FACTURA = 33
NOTA_CREDITO = 61
RUT_RECEPTOR_GENERICO = '66666666-6'
TASA_IVA = 19

# MedioPago de la boleta (formato SII): 1 efectivo, 2 pago electrónico, 3 transferencia
MEDIO_PAGO_BOLETA = {'EFECTIVO': 1, 'TARJETA_TUU': 2, 'TRANSFERENCIA': 3}


class DocumentoInvalido(ValueError):
    pass


# ---------- RUT ----------

def normalizar_rut(rut):
    """'12.345.678-k' -> '12345678-K'. Lanza DocumentoInvalido si el dígito verificador no cuadra."""
    limpio = ''.join(c for c in str(rut or '').upper() if c.isdigit() or c == 'K')
    if len(limpio) < 2 or not limpio[:-1].isdigit():
        raise DocumentoInvalido("RUT con formato inválido.")
    cuerpo, dv = limpio[:-1].lstrip('0') or '0', limpio[-1]
    suma, factor = 0, 2
    for digito in reversed(cuerpo):
        suma += int(digito) * factor
        factor = 2 if factor == 7 else factor + 1
    esperado = 11 - suma % 11
    esperado = {11: '0', 10: 'K'}.get(esperado, str(esperado))
    if dv != esperado:
        raise DocumentoInvalido("El RUT no es válido (dígito verificador incorrecto).")
    return f"{cuerpo}-{dv}"


# ---------- Montos ----------

def _redondear(valor):
    return int(Decimal(valor).quantize(Decimal('1'), rounding=ROUND_HALF_UP))


def iva_de(neto):
    """IVA de un monto neto, redondeado al peso (mitad hacia arriba)."""
    return (neto * TASA_IVA * 2 + 100) // 200


def neto_desde_total(total):
    """
    Neto N tal que N + IVA(N) sea el total con IVA. Algunos totales no son
    alcanzables por el redondeo del IVA; en ese caso se usa el neto que deja el
    total más cercano. Devuelve (neto, iva, diferencia) con
    diferencia = (neto + iva) - total (0 en la gran mayoría de los casos, o ±1).
    """
    aproximado = _redondear(Decimal(total) * 100 / (100 + TASA_IVA))
    candidatos = sorted(range(max(aproximado - 3, 0), aproximado + 4),
                        key=lambda n: (abs(n + iva_de(n) - total), n + iva_de(n) > total))
    neto = candidatos[0]
    iva = iva_de(neto)
    return neto, iva, neto + iva - total


def _precio_unitario(monto, cantidad):
    """Precio por unidad con hasta 6 decimales tal que cantidad x precio redondea al monto."""
    precio = (Decimal(monto) / Decimal(cantidad)).quantize(Decimal('0.000001'), rounding=ROUND_HALF_UP)
    precio = precio.normalize()
    return int(precio) if precio == precio.to_integral() else float(precio)


def _repartir(total, pesos):
    """Reparte `total` en proporción a `pesos` (enteros), sin perder pesos por redondeo."""
    suma = sum(pesos)
    if suma <= 0:
        return [0 for _ in pesos]
    partes, acumulado = [], 0
    for i, peso in enumerate(pesos):
        if i == len(pesos) - 1:
            partes.append(total - acumulado)
        else:
            parte = (2 * total * peso + suma) // (2 * suma)
            partes.append(parte)
            acumulado += parte
    return partes


def _lineas_validas(lineas):
    """Solo líneas con monto > 0 (una línea regalada no va en el documento)."""
    validas = [l for l in lineas if int(l['total']) > 0 and int(l['cantidad']) > 0]
    if not validas:
        raise DocumentoInvalido("La venta no tiene montos para documentar.")
    return validas


def _nombre_item(nombre):
    # OpenFactura trunca a 80 y borra el guion largo; lo reemplazamos para no perder la separación
    return (str(nombre or 'Producto').replace('–', '-').replace('—', '-').strip() or 'Producto')[:80]


# ---------- Documentos ----------

def construir_boleta(lineas, emisor, medio_pago, fecha=None):
    """
    lineas: [{'nombre', 'cantidad', 'total'}] con `total` = lo cobrado por la línea (con IVA).
    emisor: dict con rut, razon_social, giro, direccion, comuna, sucursal.
    """
    lineas = _lineas_validas(lineas)
    total = sum(int(l['total']) for l in lineas)
    neto = _redondear(Decimal(total) * 100 / (100 + TASA_IVA))
    id_doc = {
        "TipoDTE": BOLETA, "Folio": 0, "FchEmis": (fecha or date.today()).isoformat(),
        "IndServicio": 3,
    }
    if medio_pago in MEDIO_PAGO_BOLETA:
        id_doc["MedioPago"] = MEDIO_PAGO_BOLETA[medio_pago]
    return {
        "Encabezado": {
            "IdDoc": id_doc,
            "Emisor": {
                "RUTEmisor": emisor['rut'],
                "RznSocEmisor": emisor['razon_social'],
                "GiroEmisor": emisor['giro'][:80],
                **({"CdgSIISucur": emisor['sucursal']} if emisor.get('sucursal') else {}),
                "DirOrigen": emisor['direccion'],
                "CmnaOrigen": emisor['comuna'],
            },
            "Receptor": {"RUTRecep": RUT_RECEPTOR_GENERICO},
            "Totales": {
                "MntNeto": neto, "IVA": total - neto, "MntTotal": total,
                "TotalPeriodo": total, "VlrPagar": total,
            },
        },
        "Detalle": [
            {"NroLinDet": i, "NmbItem": _nombre_item(l['nombre']), "QtyItem": int(l['cantidad']),
             "PrcItem": _precio_unitario(int(l['total']), int(l['cantidad'])), "MontoItem": int(l['total'])}
            for i, l in enumerate(lineas, start=1)
        ],
    }


def construir_factura(lineas, emisor, receptor, fecha=None):
    """
    Factura afecta (33) al contado. Los montos de la caja incluyen IVA: se
    calcula el neto total y se reparte entre las líneas.
    receptor: dict con rut, razon_social, giro, direccion, comuna.
    Devuelve (dte, diferencia): diferencia = total de la factura - total cobrado (0 o ±1).
    """
    lineas = _lineas_validas(lineas)
    rut_receptor = _validar_receptor(receptor, "la factura")
    if rut_receptor == RUT_RECEPTOR_GENERICO:
        raise DocumentoInvalido("La factura necesita el RUT real del cliente.")
    id_doc = {"TipoDTE": FACTURA, "Folio": 0, "FchEmis": (fecha or date.today()).isoformat(),
              "TpoTranVenta": 1, "FmaPago": 1}
    return _documento_neto(id_doc, lineas, emisor, _receptor_dte(receptor, rut_receptor))


def construir_nota_credito(lineas, emisor, referencia, receptor=None, fecha=None):
    """
    Nota de crédito (61) por una devolución.
    lineas: lo devuelto [{'nombre', 'cantidad', 'total'}] con `total` = lo reembolsado (con IVA).
    referencia: {'tipo': 39|33, 'folio', 'fecha' (date), 'anula' (bool), 'razon'}.
    receptor: el de la factura original; None si el original es una boleta (receptor genérico).
    Devuelve (dte, diferencia): diferencia = total de la nota - total reembolsado (0 o ±1).
    """
    lineas = _lineas_validas(lineas)
    if referencia.get('tipo') not in (BOLETA, FACTURA):
        raise DocumentoInvalido("La nota de crédito debe referenciar una boleta o factura.")
    if not referencia.get('folio'):
        raise DocumentoInvalido("No se conoce el folio del documento original: no se puede emitir la nota de crédito.")
    if receptor:
        receptor_dte = _receptor_dte(receptor, _validar_receptor(receptor, "la nota de crédito"))
    else:
        # Devolución de una boleta: el cliente no está identificado
        receptor_dte = {
            "RUTRecep": RUT_RECEPTOR_GENERICO, "RznSocRecep": "CLIENTE BOLETA", "GiroRecep": "PARTICULAR",
            "DirRecep": str(emisor['direccion'])[:70], "CmnaRecep": str(emisor['comuna'])[:20],
        }
    id_doc = {"TipoDTE": NOTA_CREDITO, "Folio": 0, "FchEmis": (fecha or date.today()).isoformat()}
    dte, diferencia = _documento_neto(id_doc, lineas, emisor, receptor_dte)
    anula = bool(referencia.get('anula'))
    dte["Referencia"] = [{
        "NroLinRef": 1,
        "TpoDocRef": str(referencia['tipo']),
        "FolioRef": int(referencia['folio']),
        "FchRef": referencia['fecha'].isoformat(),
        "CodRef": 1 if anula else 3,
        "RazonRef": (str(referencia.get('razon') or '').strip()
                     or ("Anula documento" if anula else "Devolución de productos"))[:90],
    }]
    return dte, diferencia


def _validar_receptor(receptor, documento):
    for campo, nombre in (('rut', 'RUT'), ('razon_social', 'razón social'), ('giro', 'giro'),
                          ('direccion', 'dirección'), ('comuna', 'comuna')):
        if not str(receptor.get(campo) or '').strip():
            raise DocumentoInvalido(f"Para {documento} falta el/la {nombre} del cliente.")
    return normalizar_rut(receptor['rut'])


def _receptor_dte(receptor, rut_receptor):
    return {
        "RUTRecep": rut_receptor,
        "RznSocRecep": str(receptor['razon_social']).strip()[:100],
        "GiroRecep": str(receptor['giro']).strip()[:40],
        "DirRecep": str(receptor['direccion']).strip()[:70],
        "CmnaRecep": str(receptor['comuna']).strip()[:20],
        **({"CorreoRecep": receptor['email'].strip()} if receptor.get('email') else {}),
    }


def _documento_neto(id_doc, lineas, emisor, receptor_dte):
    """Documento con montos netos (factura, nota de crédito): el neto total se reparte entre las líneas."""
    total = sum(int(l['total']) for l in lineas)
    neto, iva, diferencia = neto_desde_total(total)
    netos = _repartir(neto, [int(l['total']) for l in lineas])
    dte = {
        "Encabezado": {
            "IdDoc": id_doc,
            "Emisor": {
                "RUTEmisor": emisor['rut'],
                "RznSoc": emisor['razon_social'],
                "GiroEmis": emisor['giro'][:80],
                "Acteco": int(emisor['acteco']),
                "DirOrigen": emisor['direccion'],
                "CmnaOrigen": emisor['comuna'],
                **({"CdgSIISucur": emisor['sucursal']} if emisor.get('sucursal') else {}),
            },
            "Receptor": receptor_dte,
            "Totales": {"MntNeto": neto, "TasaIVA": str(TASA_IVA), "IVA": iva, "MntTotal": neto + iva},
        },
        "Detalle": [
            {"NroLinDet": i, "NmbItem": _nombre_item(l['nombre']), "QtyItem": int(l['cantidad']),
             "PrcItem": _precio_unitario(n, int(l['cantidad'])), "MontoItem": n}
            for i, (l, n) in enumerate(zip(lineas, netos), start=1)
        ],
    }
    return dte, diferencia


# ---------- Qué documento pide la caja ----------

CAMPOS_RECEPTOR = (('rut', 'RUT'), ('razon_social', 'razón social'), ('giro', 'giro'),
                   ('direccion', 'dirección'), ('comuna', 'comuna'))


def _validar_correo(correo):
    correo = str(correo or '').strip()
    if correo and (correo.count('@') != 1 or '.' not in correo.split('@')[1] or ' ' in correo):
        raise DocumentoInvalido("El correo del cliente no es válido.")
    return correo


def leer_pedido(documento, metodo_pago, activo):
    """
    Decide qué documento emitir para una venta a partir de lo que envía la caja:
        documento = {"tipo": "BOLETA" | "FACTURA", "email": "...", "receptor": {...}}
    Devuelve None si la caja no debe emitir nada, o {"tipo": 39|33, "email", "receptor"}.
    - Emisión desactivada: nada.
    - Tarjeta: la boleta la emite el POS TUU al cobrar; la caja no emite (evita
      duplicados). Una factura con tarjeta se rechaza: hay que hacerla en el POS.
    - Efectivo / transferencia: boleta por defecto, o factura con los datos del cliente.
    Se llama ANTES de guardar la venta, para no dejar ventas sin su documento por un dato mal escrito.
    """
    if not activo:
        return None
    documento = documento or {}
    if not isinstance(documento, dict) or not isinstance(documento.get('receptor') or {}, dict):
        raise DocumentoInvalido("Los datos del documento no tienen el formato esperado.")
    tipo = str(documento.get('tipo') or 'BOLETA').upper()
    if tipo not in ('BOLETA', 'FACTURA'):
        raise DocumentoInvalido("Tipo de documento no válido.")
    email = _validar_correo(documento.get('email'))

    if metodo_pago == 'TARJETA_TUU':
        if tipo == 'FACTURA':
            raise DocumentoInvalido("Las facturas con pago con tarjeta se emiten desde el POS TUU.")
        return None

    if tipo == 'BOLETA':
        return {'tipo': BOLETA, 'email': email, 'receptor': {}}

    receptor = {campo: str((documento.get('receptor') or {}).get(campo) or '').strip()
                for campo, _ in CAMPOS_RECEPTOR}
    for campo, nombre in CAMPOS_RECEPTOR:
        if not receptor[campo]:
            raise DocumentoInvalido(f"Para la factura falta el/la {nombre} del cliente.")
    receptor['rut'] = normalizar_rut(receptor['rut'])
    if receptor['rut'] == RUT_RECEPTOR_GENERICO:
        raise DocumentoInvalido("La factura necesita el RUT real del cliente.")
    if email:
        receptor['email'] = email
    return {'tipo': FACTURA, 'email': email, 'receptor': receptor}


def folio_de(respuesta):
    """Folio desde GET /document/{token}/json (acepta el JSON envuelto o directo)."""
    datos = respuesta or {}
    if isinstance(datos.get('json'), dict):
        datos = datos['json']
    folio = datos.get('folio') or datos.get('FOLIO') or datos.get('Folio')
    if not folio:
        folio = ((datos.get('Encabezado') or {}).get('IdDoc') or {}).get('Folio')
    try:
        return int(folio) if folio else None
    except (TypeError, ValueError):
        return None
