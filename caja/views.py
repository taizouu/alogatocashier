import shopify
import json
from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from django.conf import settings
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import generics
from rest_framework import status
from django.contrib.auth.models import User
from .models import SesionCaja, PromocionLocal
from .serializers import SesionCajaSerializer, VentaLocalSerializer, PromocionLocalSerializer
from .shopify import activar_sesion_shopify
from rest_framework.permissions import IsAuthenticated

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
                "tipo": variante.get('product', {}).get('productType', '')
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
    permission_classes = [IsAuthenticated]

    def get(self, request):
        nombre = request.GET.get('nombre', '').strip()
        if not nombre:
            return Response({"error": "Debes proporcionar un término de búsqueda"}, status=status.HTTP_400_BAD_REQUEST)

        try:
            activar_sesion_shopify()
            
            # 1. CORRECCIÓN: Agregamos vendor y productType a la consulta GraphQL dentro de 'product'
            query = f"""
            {{
              productVariants(first: 15, query: "{nombre}*") {{
                edges {{
                  node {{
                    id
                    sku
                    barcode
                    price
                    title
                    inventoryQuantity
                    product {{
                      title
                      vendor
                      productType
                    }}
                  }}
                }}
              }}
            }}
            """

            resultado = shopify.GraphQL().execute(query)
            datos = json.loads(resultado)
            
            # Depuración en consola de Django
            print(f"\n--- BUSCANDO COLOR: {nombre} ---")
            print(f"RESPUESTA DE SHOPIFY: {json.dumps(datos, indent=2)}")
            print("----------------------------------\n")

            edges = datos.get('data', {}).get('productVariants', {}).get('edges', [])
            
            resultados = []
            for edge in edges:
                variante = edge['node']
                
                if variante['title'] == 'Default Title':
                    nombre_completo = variante['product']['title']
                else:
                    nombre_completo = f"{variante['product']['title']} - {variante['title']}"
                    
                # 2. CORRECCIÓN: Extraemos vendor y productType correctamente como diccionarios
                resultados.append({
                    "id_shopify": variante['id'],
                    "sku": variante.get('sku', ''),
                    "codigo_barras": variante.get('barcode', ''),
                    "nombre": nombre_completo,
                    "precio": int(float(variante['price'])), 
                    "stock_disponible": variante.get('inventoryQuantity', 0),
                    
                    # Buscamos en el producto padre (usamos .get() por seguridad)
                    "proveedor": variante.get('product', {}).get('vendor', ''), 
                    "tipo": variante.get('product', {}).get('productType', ''),
                })

            return Response(resultados, status=status.HTTP_200_OK)

        except Exception as e:
            print(f"Error grave en buscador por nombre: {e}")
            return Response(
                {"error": f"Error de conexión con Shopify: {str(e)}"}, 
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )
        finally:
            shopify.ShopifyResource.clear_session()


class ProcesarVentaView(APIView):
    permission_classes = [IsAuthenticated]
    @transaction.atomic
    def post(self, request):
        sesion = SesionCaja.objects.filter(estado='ABIERTA').first()
        if not sesion:
            return Response({"error": "No hay una sesión de caja abierta."}, status=status.HTTP_400_BAD_REQUEST)

        serializer = VentaLocalSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        venta = serializer.save(sesion=sesion)

        try:
            # 1. Activamos la sesión con la librería oficial
            activar_sesion_shopify()
            nueva_orden = shopify.Order()
            
            line_items = []
            for item in request.data['detalles']:
                variant_id = str(item['id_shopify']).split('/')[-1]
                line_items.append({
                    "variant_id": variant_id,
                    "quantity": item['cantidad'],
                    "price": str(item['precio_unitario'])
                })
            
            nueva_orden.line_items = line_items
            nueva_orden.financial_status = "paid"
            nueva_orden.fulfillment_status = "fulfilled"
            
            metodo_etiqueta = request.data.get('metodo_pago', 'EFECTIVO')
            nueva_orden.tags = f"POS_Local, {metodo_etiqueta}"
            
            # 2. Guardamos la orden en el historial de Shopify
            if nueva_orden.save():
                venta.sincronizado_shopify = True
                venta.save()
                
                # --- MÉTODO OFICIAL PARA REBAJAR STOCK ---
                location_id = int(settings.SHOPIFY_LOCATION_ID)
                
                for item in request.data['detalles']:
                    variant_id = str(item['id_shopify']).split('/')[-1]
                    cantidad_vendida = int(item['cantidad'])
                    
                    try:
                        variante = shopify.Variant.find(variant_id)
                        
                        shopify.InventoryLevel.adjust(
                            location_id=location_id,
                            inventory_item_id=variante.inventory_item_id,
                            available_adjustment=-cantidad_vendida
                        )
                    except Exception as error_stock:
                        print(f"Fallo al descontar stock del item {variant_id}: {error_stock}")
                
            else:
                print("Error de validación en Shopify:", nueva_orden.errors.full_messages())

        except Exception as e:
            print(f"Caída de red o error de API: {e}")

        finally:
            shopify.ShopifyResource.clear_session()

        return Response(
            {"mensaje": "Venta registrada con éxito", "id_venta_local": venta.id}, 
            status=status.HTTP_201_CREATED
        )

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
    permission_classes = [IsAuthenticated]
    # Traemos todas las promociones, las más nuevas primero
    queryset = PromocionLocal.objects.all().order_by('-id')
    serializer_class = PromocionLocalSerializer

class PromocionDetailView(generics.RetrieveUpdateDestroyAPIView):
    permission_classes = [IsAuthenticated]
    queryset = PromocionLocal.objects.all()
    serializer_class = PromocionLocalSerializer