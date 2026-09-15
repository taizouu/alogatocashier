import os
import requests
from rest_framework import serializers
from .models import SesionCaja, VentaLocal, DetalleVenta, PromocionLocal

class SesionCajaSerializer(serializers.ModelSerializer):
    class Meta:
        model = SesionCaja
        fields = ['id', 'cajero', 'fecha_apertura', 'monto_apertura', 'estado']
        # Protegemos estos campos para que no puedan ser alterados manualmente desde el frontend
        read_only_fields = ['id', 'cajero', 'fecha_apertura', 'estado']

class DetalleVentaSerializer(serializers.ModelSerializer):
    id_shopify = serializers.CharField(write_only=True, required=False, allow_blank=True, allow_null=True)
    codigo_barras = serializers.CharField(required=False, allow_blank=True, allow_null=True)
    sku = serializers.CharField(required=False, allow_blank=True, allow_null=True)
    nombre_producto = serializers.CharField(required=False, allow_blank=True, allow_null=True)

    class Meta:
        model = DetalleVenta
        fields = ['codigo_barras', 'sku', 'nombre_producto', 'cantidad', 'precio_unitario', 'id_shopify']

class VentaLocalSerializer(serializers.ModelSerializer):
    detalles = DetalleVentaSerializer(many=True, write_only=True)

    class Meta:
        model = VentaLocal
        fields = ['id', 'total', 'metodo_pago', 'monto_recibido', 'vuelto', 'detalles']

    def create(self, validated_data):
        detalles_data = validated_data.pop('detalles')
        venta = VentaLocal.objects.create(**validated_data)
        
        shop_url = os.getenv("SHOPIFY_STORE_URL")
        location_id = os.getenv("SHOPIFY_LOCATION_ID")
        
        # Asegúrate de obtener tu token de acceso activo a Shopify de la misma forma que lo manejas en tus vistas
        token_access = self.context.get('shopify_token') # O cámbialo por tu método/variable de token

        for detalle_data in detalles_data:
            id_shopify = detalle_data.pop('id_shopify', None)
            cantidad_vendida = detalle_data.get('cantidad', 1)
            
            # 1. Guardar el detalle de la venta en la base de datos local
            DetalleVenta.objects.create(venta=venta, **detalle_data)
            
            # 2. Descontar el stock de forma inmediata en Shopify
            if id_shopify and shop_url and location_id and token_access:
                try:
                    headers = {"X-Shopify-Access-Token": token_access}
                    
                    # Consultar el inventory_item_id asociado a la variante
                    variant_url = f"https://{shop_url}/admin/api/2024-01/variants/{id_shopify}.json"
                    response_var = requests.get(variant_url, headers=headers)
                    
                    if response_var.status_code == 200:
                        inventory_item_id = response_var.json().get('variant', {}).get('inventory_item_id')
                        
                        if inventory_item_id:
                            # Ajustar el nivel de inventario enviando la cantidad en negativo
                            adjust_url = f"https://{shop_url}/admin/api/2024-01/inventory_levels/adjust.json"
                            payload = {
                                "location_id": location_id,
                                "inventory_item_id": inventory_item_id,
                                "available_adjustment": -int(cantidad_vendida)
                            }
                            requests.post(adjust_url, json=payload, headers=headers)
                except Exception as e:
                    print(f"Error al descontar stock en Shopify: {e}")
            
        return venta

class PromocionLocalSerializer(serializers.ModelSerializer):
    class Meta:
        model = PromocionLocal
        fields = '__all__'