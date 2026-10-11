import os
import requests
from rest_framework import serializers
from .models import SesionCaja, VentaLocal, DetalleVenta, PromocionLocal, CAMPOS_FILTRO_PROMO

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
        fields = [
            'id', 'nombre', 'tipo_promocion', 'grupos',
            'precio_promocional', 'cantidad_pagada', 'porcentaje_descuento',
            'fecha_inicio', 'fecha_fin', 'activa',
        ]

    def validate_grupos(self, grupos):
        if not isinstance(grupos, list) or not grupos:
            raise serializers.ValidationError("La promoción debe tener al menos un grupo de productos.")
        if len(grupos) > 10:
            raise serializers.ValidationError("Máximo 10 grupos por promoción.")

        limpios = []
        for i, grupo in enumerate(grupos, start=1):
            if not isinstance(grupo, dict):
                raise serializers.ValidationError(f"Grupo {i}: formato inválido.")
            try:
                cantidad = int(grupo.get('cantidad'))
            except (TypeError, ValueError):
                raise serializers.ValidationError(f"Grupo {i}: la cantidad debe ser un número.")
            if cantidad < 1 or cantidad > 999:
                raise serializers.ValidationError(f"Grupo {i}: la cantidad debe estar entre 1 y 999.")

            condiciones = grupo.get('condiciones')
            if not isinstance(condiciones, list) or not condiciones:
                raise serializers.ValidationError(f"Grupo {i}: agrega al menos un filtro.")

            condiciones_limpias = []
            for condicion in condiciones:
                campo = (condicion or {}).get('campo')
                if campo not in CAMPOS_FILTRO_PROMO:
                    raise serializers.ValidationError(f"Grupo {i}: filtro '{campo}' no existe.")
                valores = (condicion or {}).get('valores')
                if not isinstance(valores, list):
                    raise serializers.ValidationError(f"Grupo {i}: los valores del filtro deben ser una lista.")
                valores = [str(v).strip() for v in valores if str(v).strip()]
                if not valores:
                    raise serializers.ValidationError(
                        f"Grupo {i}: el filtro '{CAMPOS_FILTRO_PROMO[campo]}' no tiene valores.")
                condiciones_limpias.append({'campo': campo, 'valores': valores})

            limpios.append({'cantidad': cantidad, 'condiciones': condiciones_limpias})
        return limpios

    def validate(self, data):
        # En una edición parcial (PATCH) completamos con los valores guardados
        instancia = self.instance
        def valor(campo):
            if campo in data:
                return data[campo]
            return getattr(instancia, campo, None) if instancia else None

        tipo = valor('tipo_promocion') or 'VOLUMEN'
        grupos = valor('grupos') or []

        if tipo not in PromocionLocal.TIPOS_COMBO and len(grupos) > 1:
            raise serializers.ValidationError(
                {"grupos": "Las promociones NxM y Por Mayor admiten un solo grupo de productos."})

        if tipo == 'VOLUMEN':
            if not valor('precio_promocional') or valor('precio_promocional') <= 0:
                raise serializers.ValidationError({"precio_promocional": "Indica el precio del pack."})
        elif tipo == 'POR_MAYOR':
            if not valor('precio_promocional') or valor('precio_promocional') <= 0:
                raise serializers.ValidationError({"precio_promocional": "Indica el precio por unidad."})
        elif tipo == 'PORCENTAJE':
            pct = valor('porcentaje_descuento')
            if not pct or not (1 <= pct <= 100):
                raise serializers.ValidationError({"porcentaje_descuento": "El descuento debe estar entre 1 y 100%."})
        elif tipo == 'N_X_M':
            pagadas = valor('cantidad_pagada')
            llevas = grupos[0]['cantidad'] if grupos else 0
            if not pagadas or pagadas < 1 or pagadas >= llevas:
                raise serializers.ValidationError(
                    {"cantidad_pagada": "Las unidades a pagar deben ser menos que las que se llevan."})

        inicio, fin = valor('fecha_inicio'), valor('fecha_fin')
        if inicio and fin and fin <= inicio:
            raise serializers.ValidationError({"fecha_fin": "La fecha de término debe ser posterior al inicio."})

        # Limpiamos los campos que no usa el tipo elegido para no dejar basura
        if 'tipo_promocion' in data or not instancia:
            if tipo not in ('VOLUMEN', 'POR_MAYOR'):
                data['precio_promocional'] = None
            if tipo != 'N_X_M':
                data['cantidad_pagada'] = None
            if tipo != 'PORCENTAJE':
                data['porcentaje_descuento'] = None
        return data