import shopify
import json
import logging
from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from django.conf import settings
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import generics
from rest_framework import status
from django.contrib.auth.models import User
from django.db.models import Sum, Count
from .models import SesionCaja, VentaLocal, PromocionLocal
from .serializers import SesionCajaSerializer, VentaLocalSerializer, PromocionLocalSerializer
from .shopify import activar_sesion_shopify
from .catalogo import catalogo
from .ordenes import construir_orden, crear_orden
from rest_framework.permissions import IsAuthenticated
from .permissions import IsAdmin

logger = logging.getLogger(__name__)

class AbrirSesionCajaView(APIView):
    permission_classes = [IsAuthenticated]
    def post(self, request):
        # 1. Validar que no haya una caja ya operando
        if SesionCaja.objects.filter(estado='ABIERTA').exists():
            return Response(
                {"error": "Ya existe una sesión de caja abierta. Ciérrala antes de iniciar otra."},
                status=status.HTTP_400_BAD_REQUEST
            )

        # 2. Validar los datos de entrada
        serializer = SesionCajaSerializer(data=request.data)
        if serializer.is_valid():
            # Asignamos el cajero dinámicamente según el usuario autenticado por el token
            cajero = request.user

            # 3. Guardar la sesión
            serializer.save(cajero=cajero, estado='ABIERTA')
            return Response(serializer.data, status=status.HTTP_201_CREATED)
        
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


class BuscarProductoView(APIView):
    permission_classes = [IsAuthenticated]
    
    def get(self, request):
        # 1. Capturar el código leído por la pistola
        codigo_barras = request.GET.get('codigo')
        
        if not codigo_barras:
            return Response({"error": "Debes proporcionar un código de barras"}, status=status.HTTP_400_BAD_REQUEST)

        try:
            # 2. Conectar a Shopify (pide el token automáticamente si expiró)
            activar_sesion_shopify()

            # 3. Consulta GraphQL optimizada para buscar por barcode (AGREGAMOS vendor y productType)
            query = """
            {
              productVariants(first: 1, query: "barcode:%s") {
                edges {
                  node {
                    id
                    sku
                    barcode
                    price
                    title
                    inventoryQuantity
                    product {
                      title
                      vendor
                      productType
                      tags
                    }
                  }
                }
              }
            }
            """ % codigo_barras

            # 4. Ejecutar la petición
            resultado = shopify.GraphQL().execute(query)
            datos = json.loads(resultado)

            # 5. Validar si el producto existe
            edges = datos.get('data', {}).get('productVariants', {}).get('edges', [])
            
            if not edges:
                return Response(
                    {"error": "Producto no encontrado en Shopify"}, 
                    status=status.HTTP_404_NOT_FOUND
                )

            # 6. Extraer y formatear los datos para React
            variante = edges[0]['node']
            
            # Limpiamos el nombre si es un producto sin variantes
            if variante['title'] == 'Default Title':
                nombre_completo = variante['product']['title']
            else:
                nombre_completo = f"{variante['product']['title']} - {variante['title']}"
            
            producto_formateado = {
                "id_shopify": variante['id'],
                "sku": variante.get('sku', ''),
                "codigo_barras": variante.get('barcode', ''),
                "nombre": nombre_completo,
                "precio": int(float(variante['price'])), 
                "stock_disponible": variante.get('inventoryQuantity', 0),
                
                # NUEVOS CAMPOS: Extraemos proveedor y tipo
                "proveedor": variante.get('product', {}).get('vendor', ''),
                "tipo": variante.get('product', {}).get('productType', ''),
                "etiquetas": variante.get('product', {}).get('tags', []) or [],
                "variante": '' if variante['title'] == 'Default Title' else variante['title'],
            }

            return Response(producto_formateado, status=status.HTTP_200_OK)

        except Exception as e:
            return Response(
                {"error": f"Error de conexión con Shopify: {str(e)}"}, 
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )
        finally:
            shopify.ShopifyResource.clear_session()


class BuscarProductoNombreView(APIView):
    """
    Busca productos por cualquier palabra: nombre, marca, tipo, color/variante,
    etiqueta, SKU o código de barras. Usa la copia del catálogo en memoria
    (ver caja/catalogo.py y caja/busqueda.py).
    """
    permission_classes = [IsAuthenticated]

    def get(self, request):
        nombre = request.GET.get('nombre', '').strip()
        if not nombre:
            return Response({"error": "Debes proporcionar un término de búsqueda"}, status=status.HTTP_400_BAD_REQUEST)

        try:
            resultados = catalogo.buscar(nombre[:100])
        except Exception as e:
            logger.exception("Error en el buscador por nombre")
            return Response(
                {"error": f"Error de conexión con Shopify: {str(e)}"},
                status=status.HTTP_502_BAD_GATEWAY
            )
        return Response(resultados, status=status.HTTP_200_OK)


class ProcesarVentaView(APIView):
    """
    Registra una venta: 1) la guarda en la base local, 2) crea la orden en
    Shopify con el descuento de las promociones y el medio de pago, y
    3) descuenta el stock en la ubicación de la tienda física.
    Si Shopify falla, la venta queda guardada localmente y se avisa a la caja.
    """
    permission_classes = [IsAuthenticated]

    @transaction.atomic
    def post(self, request):
        # Bloqueo de la sesión: si se está cerrando la caja, la venta espera a
        # que termine el cierre (y entonces no encontrará sesión abierta)
        sesion = SesionCaja.objects.select_for_update().filter(estado='ABIERTA').first()
        if not sesion:
            return Response({"error": "No hay una sesión de caja abierta."}, status=status.HTTP_400_BAD_REQUEST)

        serializer = VentaLocalSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        # Copia de las líneas antes de guardar (create() les quita id_shopify)
        detalles = [dict(d) for d in serializer.validated_data['detalles']]
        venta = serializer.save(sesion=sesion)

        advertencia = None
        stock_sin_descontar = []
        try:
            # 1. Orden en Shopify con el total realmente cobrado
            variables = construir_orden(
                venta.id, venta.total, venta.metodo_pago, detalles,
                moneda=getattr(settings, 'SHOPIFY_CURRENCY', 'CLP'),
            )
            venta.shopify_order_id = crear_orden(variables)
            venta.sincronizado_shopify = True
            venta.save(update_fields=['shopify_order_id', 'sincronizado_shopify'])

            # 2. Descontar stock en la ubicación de la tienda
            activar_sesion_shopify()
            location_id = int(settings.SHOPIFY_LOCATION_ID)
            for item in detalles:
                variant_id = str(item.get('id_shopify') or '').split('/')[-1]
                if not variant_id:
                    continue
                try:
                    variante = shopify.Variant.find(variant_id)
                    shopify.InventoryLevel.adjust(
                        location_id=location_id,
                        inventory_item_id=variante.inventory_item_id,
                        available_adjustment=-int(item['cantidad'])
                    )
                except Exception:
                    logger.exception("No se pudo descontar stock de la variante %s", variant_id)
                    stock_sin_descontar.append(item.get('nombre_producto') or variant_id)

        except Exception as e:
            logger.exception("No se pudo registrar la venta %s en Shopify", venta.id)
            advertencia = f"La venta se guardó en la caja, pero no se pudo registrar en Shopify: {e}"

        finally:
            shopify.ShopifyResource.clear_session()

        if stock_sin_descontar and not advertencia:
            advertencia = ("La venta se registró, pero no se pudo descontar el stock de: "
                           + ", ".join(stock_sin_descontar))

        catalogo.invalidar()  # el stock cambió

        return Response({
            "mensaje": "Venta registrada con éxito",
            "id_venta_local": venta.id,
            "sincronizado_shopify": venta.sincronizado_shopify,
            "advertencia": advertencia,
        }, status=status.HTTP_201_CREATED)


class PromocionActivaListView(generics.ListAPIView):
    permission_classes = [IsAuthenticated]
    serializer_class = PromocionLocalSerializer

    def get_queryset(self):
        ahora = timezone.now()
        
        # Filtramos ofertas activas, que ya iniciaron, y que no han vencido 
        # (o que no tienen fecha de vencimiento configurada)
        return PromocionLocal.objects.filter(
            activa=True,
            fecha_inicio__lte=ahora
        ).filter(
            Q(fecha_fin__isnull=True) | Q(fecha_fin__gte=ahora)
        )

class PromocionListCreateView(generics.ListCreateAPIView):
    permission_classes = [IsAuthenticated, IsAdmin]
    # Traemos todas las promociones, las más nuevas primero
    queryset = PromocionLocal.objects.all().order_by('-id')
    serializer_class = PromocionLocalSerializer

class PromocionDetailView(generics.RetrieveUpdateDestroyAPIView):
    permission_classes = [IsAuthenticated, IsAdmin]
    queryset = PromocionLocal.objects.all()
    serializer_class = PromocionLocalSerializer


class OpcionesPromocionView(APIView):
    """
    Entrega los valores reales del catálogo de Shopify (proveedores, tipos y
    etiquetas) para que el admin elija de una lista en vez de escribirlos a
    mano: un error de tipeo haría que la promoción nunca se aplique.
    Se guardan en caché 10 minutos para no consultar Shopify en cada apertura.
    """
    permission_classes = [IsAuthenticated, IsAdmin]
    CACHE_KEY = 'promociones_opciones_catalogo'

    QUERY = """
    query ($cursorVendors: String, $cursorTypes: String, $cursorTags: String) {
      productVendors(first: 250, after: $cursorVendors) { edges { node } pageInfo { hasNextPage endCursor } }
      productTypes(first: 250, after: $cursorTypes) { edges { node } pageInfo { hasNextPage endCursor } }
      productTags(first: 250, after: $cursorTags) { edges { node } pageInfo { hasNextPage endCursor } }
    }
    """

    def get(self, request):
        from django.core.cache import cache
        from .models import CAMPOS_FILTRO_PROMO

        datos = cache.get(self.CACHE_KEY)
        if datos is None or request.GET.get('refrescar'):
            try:
                activar_sesion_shopify()
                datos = self._leer_catalogo()
                cache.set(self.CACHE_KEY, datos, 600)
            except Exception as e:
                return Response({"error": f"No se pudo leer el catálogo de Shopify: {e}"},
                                status=status.HTTP_502_BAD_GATEWAY)
            finally:
                shopify.ShopifyResource.clear_session()

        return Response({
            "campos": [{"clave": k, "nombre": v} for k, v in CAMPOS_FILTRO_PROMO.items()],
            **datos,
        })

    def _leer_catalogo(self):
        claves = {'productVendors': 'proveedores', 'productTypes': 'tipos', 'productTags': 'etiquetas'}
        cursores = {'productVendors': 'cursorVendors', 'productTypes': 'cursorTypes', 'productTags': 'cursorTags'}
        resultado = {v: set() for v in claves.values()}
        variables = {}
        pendientes = set(claves)

        # Paginamos hasta 10 vueltas (2.500 valores por lista) como tope de seguridad
        for _ in range(10):
            respuesta = json.loads(shopify.GraphQL().execute(self.QUERY, variables=variables))
            if respuesta.get('errors'):
                raise Exception('; '.join(e.get('message', '') for e in respuesta['errors']))
            data = respuesta['data']
            for campo in list(pendientes):
                bloque = data[campo]
                resultado[claves[campo]].update(e['node'] for e in bloque['edges'] if e['node'])
                if bloque['pageInfo']['hasNextPage']:
                    variables[cursores[campo]] = bloque['pageInfo']['endCursor']
                else:
                    pendientes.discard(campo)
            if not pendientes:
                break
            # Las listas ya completas no se vuelven a pedir con cursor nuevo; repetirlas no suma valores
        return {k: sorted(v, key=str.lower) for k, v in resultado.items()}


class EstadoCajaView(APIView):
    """
    Retorna el estado actual de la caja: si hay sesión abierta y su información básica.
    El frontend usa esto para saber si mostrar el botón de cierre.
    """
    permission_classes = [IsAuthenticated]

    def get(self, request):
        sesion = SesionCaja.objects.filter(estado='ABIERTA').first()
        if not sesion:
            return Response({"abierta": False}, status=status.HTTP_200_OK)

        return Response({
            "abierta": True,
            "sesion_id": sesion.id,
            "cajero": sesion.cajero.username,
            "fecha_apertura": sesion.fecha_apertura,
            "monto_apertura": sesion.monto_apertura,
        }, status=status.HTTP_200_OK)


class CerrarSesionCajaView(APIView):
    """
    Cierre de caja (Reporte Z):
    - Calcula el monto esperado en efectivo (apertura + ventas en efectivo
      - reembolsos en efectivo). El total de cada venta ya es lo que queda en
      la caja (lo recibido menos el vuelto), así que el vuelto NO se resta.
    - Recibe el monto real contado por el cajero
    - Calcula la diferencia (sobrante/faltante)
    - Retorna un resumen completo por método de pago
    """
    permission_classes = [IsAuthenticated]

    @transaction.atomic
    def post(self, request):
        # 1. Buscar la sesión abierta y bloquearla: las ventas y reembolsos que
        # lleguen durante el cierre esperan, así ninguno queda fuera del cuadre
        sesion = SesionCaja.objects.select_for_update().filter(estado='ABIERTA').first()
        if not sesion:
            return Response(
                {"error": "No hay una sesión de caja abierta para cerrar."},
                status=status.HTTP_400_BAD_REQUEST
            )

        # 2. Validar monto real ingresado por el cajero
        monto_cierre_real = request.data.get('monto_cierre_real')
        if monto_cierre_real is None:
            return Response(
                {"error": "Debes ingresar el monto real contado en caja."},
                status=status.HTTP_400_BAD_REQUEST
            )

        try:
            monto_cierre_real = int(monto_cierre_real)
        except (ValueError, TypeError):
            return Response(
                {"error": "El monto debe ser un número entero válido."},
                status=status.HTTP_400_BAD_REQUEST
            )

        # 3. Obtener todas las ventas de esta sesión
        ventas = VentaLocal.objects.filter(sesion=sesion)

        # 4. Calcular totales por método de pago
        ventas_efectivo = ventas.filter(metodo_pago='EFECTIVO')
        ventas_tarjeta = ventas.filter(metodo_pago='TARJETA_TUU')
        ventas_transferencia = ventas.filter(metodo_pago='TRANSFERENCIA')

        total_efectivo = ventas_efectivo.aggregate(total=Sum('total'))['total'] or 0
        total_tarjeta = ventas_tarjeta.aggregate(total=Sum('total'))['total'] or 0
        total_transferencia = ventas_transferencia.aggregate(total=Sum('total'))['total'] or 0

        # Vueltos entregados en ventas en efectivo (solo informativo)
        total_vueltos = ventas_efectivo.aggregate(total=Sum('vuelto'))['total'] or 0

        # Reembolsos entregados durante esta sesión (de ventas de hoy o anteriores)
        devoluciones = sesion.devoluciones.all()
        reembolsos_efectivo = devoluciones.filter(metodo_reembolso='EFECTIVO').aggregate(total=Sum('total'))['total'] or 0
        reembolsos_total = devoluciones.aggregate(total=Sum('total'))['total'] or 0

        # 5. Calcular monto esperado en caja (solo efectivo afecta la caja física).
        # Ojo: el total de la venta ya descuenta el vuelto; restarlo de nuevo
        # lo contaría dos veces.
        monto_esperado = sesion.monto_apertura + int(total_efectivo) - int(reembolsos_efectivo)

        # 6. Calcular diferencia
        diferencia = monto_cierre_real - monto_esperado

        # 7. Cerrar la sesión
        sesion.monto_cierre_esperado = monto_esperado
        sesion.monto_cierre_real = monto_cierre_real
        sesion.fecha_cierre = timezone.now()
        sesion.estado = 'CERRADA'
        sesion.save()

        # 8. Armar el Reporte Z
        total_ventas = int(total_efectivo) + int(total_tarjeta) + int(total_transferencia)
        cantidad_ventas = ventas.count()

        reporte = {
            "mensaje": "Caja cerrada exitosamente.",
            "sesion_id": sesion.id,
            "cajero": sesion.cajero.username,
            "fecha_apertura": sesion.fecha_apertura,
            "fecha_cierre": sesion.fecha_cierre,

            # Resumen financiero
            "monto_apertura": sesion.monto_apertura,
            "monto_cierre_esperado": monto_esperado,
            "monto_cierre_real": monto_cierre_real,
            "diferencia": diferencia,

            # Devoluciones procesadas en esta sesión
            "devoluciones": {
                "cantidad": devoluciones.count(),
                "total": int(reembolsos_total),
                "efectivo": int(reembolsos_efectivo),
            },

            # Desglose por método de pago
            "resumen_ventas": {
                "cantidad_total": cantidad_ventas,
                "total_general": total_ventas,
                "efectivo": {
                    "cantidad": ventas_efectivo.count(),
                    "total": int(total_efectivo),
                    "vueltos": int(total_vueltos),
                },
                "tarjeta_tuu": {
                    "cantidad": ventas_tarjeta.count(),
                    "total": int(total_tarjeta),
                },
                "transferencia": {
                    "cantidad": ventas_transferencia.count(),
                    "total": int(total_transferencia),
                },
            }
        }

        return Response(reporte, status=status.HTTP_200_OK)

class AccesoRapidoView(APIView):
    """
    Productos de los botones de acceso rápido de la caja (Caps, Puntas...),
    con foto, precio y stock, desde la copia del catálogo en memoria.
    Configuración en settings.ACCESOS_RAPIDOS.
    """
    permission_classes = [IsAuthenticated]

    def get(self, request):
        try:
            grupos = [
                {
                    "clave": g['clave'],
                    "nombre": g['nombre'],
                    "agrupar_por": g.get('agrupar_por', 'etiqueta'),
                    "productos": catalogo.por_tipo(g['tipos']),
                }
                for g in settings.ACCESOS_RAPIDOS
            ]
        except Exception as e:
            logger.exception("Error al cargar los accesos rápidos")
            return Response({"error": f"No se pudo leer el catálogo de Shopify: {e}"},
                            status=status.HTTP_502_BAD_GATEWAY)
        return Response(grupos)
