"""
Devoluciones y anulaciones de ventas (solo administradores).

POST /api/ventas/<id>/devoluciones/
    {
      "items": [{"detalle_id": 12, "cantidad": 1}],   # o bien "anular": true
      "motivo": "Lata con falla",
      "metodo_reembolso": "EFECTIVO",                 # opcional: por defecto el de la venta
      "repone_stock": true                            # opcional: por defecto true
    }

1. En la base local (bloqueando la venta para evitar devoluciones dobles):
   valida cantidades, calcula el reembolso (lo pagado, con promociones) y
   registra la devolución. Un reembolso en efectivo exige caja abierta y se
   descuenta del efectivo esperado al cerrarla.
2. En Shopify: registra el reembolso en la orden y repone el stock en la
   tienda (refundCreate con clave de idempotencia: un reintento no
   reembolsa dos veces). Si falla, la devolución local queda hecha y se
   devuelve un aviso.
3. Nota de crédito: si la venta tiene una boleta o factura emitida por la
   caja (OpenFactura), se emite la nota de crédito por lo devuelto. Si
   falla, queda "Con error" para reintentarla en Boletas y Facturas.
"""
import logging
import uuid

import shopify
from django.conf import settings
from django.db import transaction
from django.db.models import Sum
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .catalogo import catalogo
from .models import DetalleDevolucion, Devolucion, SesionCaja, VentaLocal
from .permissions import IsAdmin
from .reembolsos import (MUTATION_REEMBOLSO, QUERY_ORDEN, DevolucionInvalida,
                         cobrado_por_linea, construir_reembolso, monto_a_reembolsar)
from .shopify import activar_sesion_shopify, graphql_admin

logger = logging.getLogger(__name__)

# Espacio fijo para generar claves de idempotencia reproducibles por devolución
_ESPACIO_CLAVES = uuid.UUID('6b1d3f2e-7c55-4b0a-9a51-3c1f0f6f2a10')


def estado_lineas(venta):
    """
    Por cada línea: (detalle, unidades ya devueltas, monto ya devuelto, monto cobrado).
    El monto cobrado de ventas antiguas sale de repartir el total real de la venta.
    """
    devuelto = {
        f['detalle_venta_id']: (f['unidades'] or 0, f['monto'] or 0)
        for f in DetalleDevolucion.objects.filter(detalle_venta__venta=venta)
        .values('detalle_venta_id').annotate(unidades=Sum('cantidad'), monto=Sum('monto'))
    }
    detalles = list(venta.detalles.all().order_by('id'))
    cobrados = cobrado_por_linea(venta.total, [(d.total_linea, d.subtotal()) for d in detalles])
    return {d.id: (d, *devuelto.get(d.id, (0, 0)), cobrado) for d, cobrado in zip(detalles, cobrados)}


class CrearDevolucionView(APIView):
    permission_classes = [IsAuthenticated, IsAdmin]

    def post(self, request, pk):
        datos = request.data
        motivo = str(datos.get('motivo') or '').strip()
        if not motivo:
            return Response({"error": "Indica el motivo de la devolución."}, status=status.HTTP_400_BAD_REQUEST)

        try:
            with transaction.atomic():
                devolucion, devueltos = self._registrar_local(request, pk, datos, motivo)
        except VentaLocal.DoesNotExist:
            return Response({"error": "La venta no existe."}, status=status.HTTP_404_NOT_FOUND)
        except DevolucionInvalida as e:
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)

        aviso = self._registrar_en_shopify(devolucion, devueltos)
        catalogo.invalidar()  # el stock cambió
        nota_credito, aviso_nota = self._emitir_nota_credito(devolucion, request.user)
        aviso = ' '.join(filter(None, [aviso, aviso_nota])) or None

        return Response({
            "mensaje": "Anulación registrada" if devolucion.es_anulacion else "Devolución registrada",
            "devolucion_id": devolucion.id,
            "total_reembolsado": devolucion.total,
            "metodo_reembolso": devolucion.get_metodo_reembolso_display(),
            "sincronizado_shopify": devolucion.sincronizado_shopify,
            "advertencia": aviso,
            "nota_credito": nota_credito,
        }, status=status.HTTP_201_CREATED)

    # ---------- 3. Nota de crédito ----------
    def _emitir_nota_credito(self, devolucion, usuario):
        """(datos de la nota o None, aviso o None). Nunca lanza: la devolución ya está hecha."""
        from .documentos import DocumentoSerializer, emitir_nota_credito  # evita import circular
        from .dte import DocumentoInvalido
        try:
            nota = emitir_nota_credito(devolucion, usuario)
        except DocumentoInvalido as e:
            return None, f"No se emitió la nota de crédito: {e}"
        except Exception as e:
            logger.exception("No se pudo emitir la nota de crédito de la devolución %s", devolucion.id)
            return None, f"No se pudo emitir la nota de crédito ({e}). Revisa Boletas y Facturas."
        if not nota:
            return None, None
        aviso = None
        if nota.estado == 'ERROR':
            aviso = f"La nota de crédito no se emitió: {nota.error} Puedes reintentarla en Boletas y Facturas."
        return DocumentoSerializer(nota).data, aviso

    # ---------- 1. Base local ----------
    def _registrar_local(self, request, pk, datos, motivo):
        venta = VentaLocal.objects.select_for_update().get(pk=pk)
        lineas = estado_lineas(venta)

        anular = bool(datos.get('anular'))
        if anular:
            pedidos = [{'detalle_id': d.id, 'cantidad': d.cantidad - unidades}
                       for d, unidades, _, _ in lineas.values() if d.cantidad - unidades > 0]
            if not pedidos:
                raise DevolucionInvalida("Esta venta ya fue devuelta por completo.")
        else:
            pedidos = datos.get('items') or []
            if not pedidos:
                raise DevolucionInvalida("Elige al menos un producto para devolver.")

        metodo = datos.get('metodo_reembolso') or venta.metodo_pago
        if metodo not in dict(VentaLocal.METODOS_PAGO):
            raise DevolucionInvalida("Medio de reembolso no válido.")

        # Bloqueamos la sesión: si justo se está cerrando la caja, esperamos a
        # que termine para que el reembolso no quede fuera del cuadre
        sesion = SesionCaja.objects.select_for_update().filter(estado='ABIERTA').first()
        if metodo == 'EFECTIVO' and not sesion:
            raise DevolucionInvalida("Para reembolsar en efectivo la caja debe estar abierta.")

        filas, vistos = [], set()
        for pedido in pedidos:
            try:
                detalle_id, cantidad = int(pedido['detalle_id']), int(pedido['cantidad'])
            except (KeyError, TypeError, ValueError):
                raise DevolucionInvalida("Formato de productos no válido.")
            if detalle_id not in lineas:
                raise DevolucionInvalida("Uno de los productos no pertenece a esta venta.")
            if detalle_id in vistos:
                raise DevolucionInvalida("Un producto aparece repetido en la devolución.")
            vistos.add(detalle_id)
            detalle, unidades, monto_devuelto, cobrado = lineas[detalle_id]
            monto = monto_a_reembolsar(cobrado, detalle.cantidad, unidades, monto_devuelto, cantidad)
            filas.append((detalle, cantidad, monto))

        # Red de seguridad: nunca se reembolsa más de lo que se cobró en la venta
        ya_reembolsado = sum(m for _, _, m, _ in lineas.values())
        if ya_reembolsado + sum(m for _, _, m in filas) > int(venta.total):
            raise DevolucionInvalida("El reembolso superaría el total cobrado en la venta.")

        # Es anulación si, tras esta devolución, no queda nada de la venta
        quedan = sum(d.cantidad - u for d, u, _, _ in lineas.values()) - sum(c for _, c, _ in filas)
        devolucion = Devolucion.objects.create(
            venta=venta, sesion=sesion, usuario=request.user, motivo=motivo[:255],
            metodo_reembolso=metodo, total=sum(m for _, _, m in filas),
            repone_stock=bool(datos.get('repone_stock', True)), es_anulacion=(quedan == 0),
        )
        DetalleDevolucion.objects.bulk_create([
            DetalleDevolucion(devolucion=devolucion, detalle_venta=d, cantidad=c, monto=m)
            for d, c, m in filas
        ])
        return devolucion, [(d, c) for d, c, _ in filas]

    # ---------- 2. Shopify ----------
    def _registrar_en_shopify(self, devolucion, devueltos):
        venta = devolucion.venta
        try:
            if venta.shopify_order_id:
                aviso = self._reembolso_en_orden(devolucion, devueltos)
            else:
                aviso = self._reponer_stock_venta_antigua(devolucion, devueltos)
        except Exception as e:
            logger.exception("No se pudo registrar la devolución %s en Shopify", devolucion.id)
            aviso = f"La devolución quedó registrada en la caja, pero no en Shopify: {e}"
        if aviso:
            devolucion.aviso_shopify = aviso[:500]
            devolucion.save(update_fields=['aviso_shopify', 'sincronizado_shopify', 'shopify_refund_id'])
        return aviso

    def _reembolso_en_orden(self, devolucion, devueltos):
        orden = graphql_admin(QUERY_ORDEN, {"id": devolucion.venta.shopify_order_id})['order']
        if not orden:
            raise Exception("la orden ya no existe en Shopify")

        # Ventas hechas antes de guardar la variante: la buscamos por código o SKU
        variantes, sin_variante = [], []
        for detalle, cantidad in devueltos:
            variante = detalle.shopify_variant_id or catalogo.buscar_variante(detalle.codigo_barras, detalle.sku or '')
            if variante:
                variantes.append({'variant_id': variante, 'cantidad': cantidad})
            else:
                sin_variante.append(detalle.nombre_producto)
        entrada, aviso = construir_reembolso(
            orden,
            variantes,
            devolucion.total, devolucion.metodo_reembolso, devolucion.repone_stock,
            settings.SHOPIFY_LOCATION_ID,
            f"{'Anulación' if devolucion.es_anulacion else 'Devolución'} caja #{devolucion.id}: {devolucion.motivo}",
            moneda=getattr(settings, 'SHOPIFY_CURRENCY', 'CLP'),
        )
        clave = str(uuid.uuid5(_ESPACIO_CLAVES, f"devolucion-{devolucion.id}"))
        resultado = graphql_admin(MUTATION_REEMBOLSO, {"input": entrada, "clave": clave})['refundCreate']
        if resultado['userErrors']:
            raise Exception('; '.join(e['message'] for e in resultado['userErrors']))

        devolucion.sincronizado_shopify = True
        devolucion.shopify_refund_id = resultado['refund']['id']
        devolucion.save(update_fields=['sincronizado_shopify', 'shopify_refund_id'])
        if sin_variante:
            aviso = (aviso + " " if aviso else "") + \
                "No se identificó en Shopify: " + ", ".join(sin_variante) + "."
        return aviso

    def _reponer_stock_venta_antigua(self, devolucion, devueltos):
        """Venta sin orden vinculada (anterior a la actualización): solo reponemos stock."""
        aviso = "Venta antigua sin orden vinculada en Shopify: el reembolso quedó solo en la caja."
        if not devolucion.repone_stock:
            return aviso
        fallidos = []
        try:
            activar_sesion_shopify()
            for detalle, cantidad in devueltos:
                variante_id = detalle.shopify_variant_id or catalogo.buscar_variante(detalle.codigo_barras, detalle.sku or '')
                if not variante_id:
                    fallidos.append(detalle.nombre_producto)
                    continue
                try:
                    variante = shopify.Variant.find(str(variante_id).split('/')[-1])
                    shopify.InventoryLevel.adjust(
                        location_id=int(settings.SHOPIFY_LOCATION_ID),
                        inventory_item_id=variante.inventory_item_id,
                        available_adjustment=int(cantidad),
                    )
                except Exception:
                    logger.exception("No se pudo reponer stock de %s", detalle.nombre_producto)
                    fallidos.append(detalle.nombre_producto)
        finally:
            shopify.ShopifyResource.clear_session()
        if fallidos:
            aviso += " No se pudo reponer el stock de: " + ", ".join(fallidos) + "."
        else:
            aviso += " El stock sí se repuso."
        return aviso
