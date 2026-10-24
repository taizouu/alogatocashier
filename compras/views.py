import json
import logging
import shopify
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import generics
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from django.db import transaction
from django.conf import settings
from .serializers import FacturaCompraSerializer, ProveedorSerializer
from .models import Proveedor, FacturaCompra
from caja.permissions import IsAdmin
from caja.shopify import activar_sesion_shopify
from caja.catalogo import catalogo

logger = logging.getLogger(__name__)

class IngresarFacturaView(APIView):
    permission_classes = [IsAuthenticated, IsAdmin]

    @transaction.atomic
    def post(self, request):
        serializer = FacturaCompraSerializer(data=request.data)
        
        if serializer.is_valid():
            # 1. Guardar la transacción en la base de datos local (PostgreSQL)
            factura = serializer.save()
            
            # 2. Intentar la sincronización con Shopify
            try:
                # Activamos la sesión usando tu helper oficial con el token temporal
                # (Esta era la pieza que faltaba y causaba el error de NoneType)
                from caja.shopify import activar_sesion_shopify
                activar_sesion_shopify()
                
                location_id = int(settings.SHOPIFY_LOCATION_ID)
                
                for detalle in factura.detalles.all():
                    if detalle.shopify_variant_id:
                        # Extraemos el número limpio del ID de Shopify (igual que en ventas)
                        variant_id = str(detalle.shopify_variant_id).split('/')[-1]
                        cantidad_recibida = int(detalle.cantidad)
                        
                        # Buscamos la variante para obtener su verdadero inventory_item_id
                        variante = shopify.Variant.find(variant_id)
                        
                        shopify.InventoryLevel.adjust(
                            location_id=location_id,
                            inventory_item_id=variante.inventory_item_id,
                            available_adjustment=cantidad_recibida  # Positivo porque es una compra/ingreso
                        )
                
                # 3. Si todo el bucle termina sin excepciones, marcamos como sincronizado
                factura.sincronizado_shopify = True
                factura.save()
                catalogo.invalidar()  # el stock cambió
                
                return Response({
                    "mensaje": "Factura ingresada y stock aumentado en Shopify exitosamente.",
                    "folio": factura.folio
                }, status=status.HTTP_201_CREATED)

            except Exception as e:
                print(f"🔥 ERROR DE SHOPIFY AL AJUSTAR STOCK EN COMPRAS: {str(e)}")
                
                # HTTP 207 Multi-Status indica que la operación fue un éxito parcial (guardado local, falló nube)
                return Response({
                    "mensaje": "Factura guardada localmente, pero falló la sincronización con Shopify.",
                    "error": str(e)
                }, status=status.HTTP_207_MULTI_STATUS)
            
            finally:
                shopify.ShopifyResource.clear_session()
                
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

class AsociarCodigoBarrasView(APIView):
    """
    Asigna un código de barras a una variante que ya existe en Shopify.
    Se usa en el ingreso de facturas cuando la pistola lee un código que
    Shopify no conoce: el admin busca el producto por nombre y lo asocia.

    Body: { "variant_id": "gid://shopify/ProductVariant/123" | "123",
            "barcode": "7801234567890",
            "reemplazar": false }

    Respuestas:
      200 -> producto formateado igual que /api/buscar-producto/
      409 -> el código ya pertenece a otra variante, o la variante ya tiene
             otro código y no se pidió reemplazar (incluye barcode_actual)
      403 -> la app de Shopify no tiene el permiso write_products
    """
    permission_classes = [IsAuthenticated, IsAdmin]

    QUERY_VARIANTE = """
    query ($id: ID!) {
      productVariant(id: $id) {
        id sku barcode title price inventoryQuantity
        product { id title vendor productType }
      }
    }
    """

    QUERY_BUSCAR_BARCODE = """
    query ($q: String!) {
      productVariants(first: 5, query: $q) {
        edges { node { id barcode title product { title } } }
      }
    }
    """

    MUTATION_ACTUALIZAR = """
    mutation ($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
      productVariantsBulkUpdate(productId: $productId, variants: $variants) {
        productVariants { id barcode }
        userErrors { field message }
      }
    }
    """

    @staticmethod
    def _ejecutar(query, variables):
        resultado = json.loads(shopify.GraphQL().execute(query, variables=variables))
        errores = resultado.get('errors')
        if errores:
            mensaje = '; '.join(e.get('message', str(e)) for e in errores)
            codigo = (errores[0].get('extensions') or {}).get('code', '')
            if codigo == 'ACCESS_DENIED' or 'access denied' in mensaje.lower():
                raise PermissionError(mensaje)
            raise Exception(mensaje)
        return resultado['data']

    @staticmethod
    def _nombre(variante, producto):
        if variante['title'] == 'Default Title':
            return producto['title']
        return f"{producto['title']} - {variante['title']}"

    def post(self, request):
        variant_id = str(request.data.get('variant_id', '')).strip()
        barcode = str(request.data.get('barcode', '')).strip()
        reemplazar = bool(request.data.get('reemplazar', False))

        if not variant_id or not barcode:
            return Response({"error": "Debes indicar la variante y el código de barras."},
                            status=status.HTTP_400_BAD_REQUEST)
        if len(barcode) > 255 or any(c in barcode for c in '"\\:'):
            return Response({"error": "El código de barras tiene caracteres no válidos."},
                            status=status.HTTP_400_BAD_REQUEST)

        if not variant_id.startswith('gid://'):
            variant_id = f"gid://shopify/ProductVariant/{variant_id}"

        try:
            activar_sesion_shopify()

            # 1. Leer la variante destino
            variante = self._ejecutar(self.QUERY_VARIANTE, {"id": variant_id}).get('productVariant')
            if not variante:
                return Response({"error": "La variante no existe en Shopify."},
                                status=status.HTTP_404_NOT_FOUND)
            producto = variante['product']

            # 2. El código no puede estar ya en otra variante
            data = self._ejecutar(self.QUERY_BUSCAR_BARCODE, {"q": f'barcode:"{barcode}"'})
            for edge in data['productVariants']['edges']:
                otra = edge['node']
                if otra['barcode'] == barcode and otra['id'] != variante['id']:
                    return Response({
                        "error": f"El código {barcode} ya está asignado a "
                                 f"\"{self._nombre(otra, otra['product'])}\".",
                        "conflicto": "CODIGO_EN_USO",
                    }, status=status.HTTP_409_CONFLICT)

            # 3. Si la variante ya tenía otro código, pedir confirmación
            barcode_actual = variante.get('barcode') or ''
            if barcode_actual and barcode_actual != barcode and not reemplazar:
                return Response({
                    "error": f"Esta variante ya tiene el código {barcode_actual}.",
                    "conflicto": "VARIANTE_CON_CODIGO",
                    "barcode_actual": barcode_actual,
                }, status=status.HTTP_409_CONFLICT)

            # 4. Actualizar en Shopify (si ya era el mismo código, no hace falta)
            if barcode_actual != barcode:
                resultado = self._ejecutar(self.MUTATION_ACTUALIZAR, {
                    "productId": producto['id'],
                    "variants": [{"id": variante['id'], "barcode": barcode}],
                })['productVariantsBulkUpdate']
                if resultado['userErrors']:
                    mensaje = '; '.join(e['message'] for e in resultado['userErrors'])
                    return Response({"error": f"Shopify rechazó el cambio: {mensaje}"},
                                    status=status.HTTP_400_BAD_REQUEST)

            catalogo.invalidar()  # el buscador debe ver el código nuevo
            logger.info("Código %s asociado a la variante %s por %s",
                        barcode, variante['id'], request.user.username)

            # 5. Devolver el producto con el mismo formato que el buscador
            return Response({
                "id_shopify": variante['id'],
                "sku": variante.get('sku') or '',
                "codigo_barras": barcode,
                "nombre": self._nombre(variante, producto),
                "precio": int(float(variante['price'])),
                "stock_disponible": variante.get('inventoryQuantity') or 0,
                "proveedor": producto.get('vendor') or '',
                "tipo": producto.get('productType') or '',
            }, status=status.HTTP_200_OK)

        except PermissionError:
            return Response({
                "error": "La app de Shopify no tiene permiso para editar productos. "
                         "Activa el permiso 'write_products' en la configuración de la app."
            }, status=status.HTTP_403_FORBIDDEN)
        except Exception as e:
            logger.exception("Error al asociar código de barras")
            return Response({"error": f"Error de conexión con Shopify: {e}"},
                            status=status.HTTP_502_BAD_GATEWAY)
        finally:
            shopify.ShopifyResource.clear_session()


class ProveedorListCreateView(generics.ListCreateAPIView):
    permission_classes = [IsAuthenticated, IsAdmin]
    # Traemos solo los activos y ordenados alfabéticamente
    queryset = Proveedor.objects.filter(activo=True).order_by('razon_social')
    serializer_class = ProveedorSerializer

class HistorialFacturasView(generics.ListAPIView):
    permission_classes = [IsAuthenticated, IsAdmin]
    # Ordenamos para que las facturas más recientes salgan primero
    queryset = FacturaCompra.objects.all().order_by('-fecha_emision', '-id')
    serializer_class = FacturaCompraSerializer