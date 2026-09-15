import shopify
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import generics
from rest_framework import status
from django.db import transaction
from django.conf import settings
from .serializers import FacturaCompraSerializer, ProveedorSerializer
from .models import Proveedor, FacturaCompra
from rest_framework.generics import ListAPIView

class IngresarFacturaView(APIView):
    
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
                from caja.views import activar_sesion_shopify  # O importa la función según tu estructura de apps
                # Nota: Si este archivo está en la misma app o puedes importar la función directamente, 
                # asegúrate de llamarla. Abajo la definimos directo o la importamos.
                
                # Activamos sesión
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

class ProveedorListCreateView(generics.ListCreateAPIView):
    # Traemos solo los activos y ordenados alfabéticamente
    queryset = Proveedor.objects.filter(activo=True).order_by('razon_social')
    serializer_class = ProveedorSerializer

class HistorialFacturasView(generics.ListAPIView):
    # Ordenamos para que las facturas más recientes salgan primero
    queryset = FacturaCompra.objects.all().order_by('-fecha_emision', '-id')
    serializer_class = FacturaCompraSerializer