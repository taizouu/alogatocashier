from rest_framework import serializers
from .models import Proveedor, FacturaCompra, DetalleFactura # Ajusta las importaciones a tus modelos reales

class ProveedorSerializer(serializers.ModelSerializer):
    class Meta:
        model = Proveedor
        fields = ['id', 'rut', 'razon_social', 'telefono', 'email', 'activo']

class DetalleFacturaSerializer(serializers.ModelSerializer):
    # Estos campos coinciden exactamente con el JSON que armamos en React
    sku = serializers.CharField(required=False, allow_blank=True, allow_null=True)
    shopify_variant_id = serializers.CharField(required=True)
    cantidad = serializers.IntegerField(min_value=1)
    costo_unitario = serializers.DecimalField(max_digits=10, decimal_places=2)

    class Meta:
        model = DetalleFactura
        fields = ['sku', 'shopify_variant_id', 'cantidad', 'costo_unitario']

class FacturaCompraSerializer(serializers.ModelSerializer):
    # Anidamos los detalles para recibirlos en el mismo JSON
    detalles = DetalleFacturaSerializer(many=True)

    class Meta:
        model = FacturaCompra
        fields = ['id', 'folio', 'proveedor', 'fecha_emision', 'sincronizado_shopify', 'detalles']

    def create(self, validated_data):
        # 1. Extraemos el arreglo de productos (detalles) del payload
        detalles_data = validated_data.pop('detalles')
        
        # 2. Creamos la cabecera de la factura en la BD
        factura = FacturaCompra.objects.create(**validated_data)
        
        # 3. Iteramos y creamos cada producto asociándolo a la factura recién creada
        for detalle_data in detalles_data:
            DetalleFactura.objects.create(factura=factura, **detalle_data)
            
        # Retornamos la factura completa. (La conexión a Shopify ocurre después en views.py)
        return factura