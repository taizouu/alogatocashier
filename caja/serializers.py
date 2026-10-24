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
    cantidad = serializers.IntegerField(min_value=1)
    precio_unitario = serializers.IntegerField(min_value=0)
    # Lo que se cobró por la línea con promociones (si no viene, el precio normal)
    total_linea = serializers.IntegerField(min_value=0, required=False, allow_null=True)
    promocion = serializers.CharField(required=False, allow_blank=True, allow_null=True, max_length=255)

    class Meta:
        model = DetalleVenta
        fields = ['codigo_barras', 'sku', 'nombre_producto', 'cantidad', 'precio_unitario',
                  'total_linea', 'promocion', 'id_shopify']

    # Las columnas de texto no admiten NULL: un producto sin código o sin
    # nombre se guarda con texto vacío en vez de fallar.
    def validate_codigo_barras(self, valor):
        return (valor or '').strip()

    def validate_nombre_producto(self, valor):
        return (valor or '').strip()

    def validate_promocion(self, valor):
        return (valor or '').strip()

    def validate(self, data):
        normal = data['precio_unitario'] * data['cantidad']
        if data.get('total_linea') is None:
            data['total_linea'] = normal
        elif data['total_linea'] > normal:
            raise serializers.ValidationError(
                f"'{data.get('nombre_producto')}': el total con descuento no puede superar el precio normal.")
        return data


class VentaLocalSerializer(serializers.ModelSerializer):
    detalles = DetalleVentaSerializer(many=True, write_only=True)

    class Meta:
        model = VentaLocal
        fields = ['id', 'total', 'metodo_pago', 'monto_recibido', 'vuelto', 'detalles']

    def validate(self, data):
        if not data.get('detalles'):
            raise serializers.ValidationError("La venta no tiene productos.")
        # El total cobrado debe ser exactamente la suma de las líneas con descuento
        suma_lineas = sum(d['total_linea'] for d in data['detalles'])
        if int(round(data['total'])) != suma_lineas:
            raise serializers.ValidationError(
                f"El total de la venta (${int(data['total'])}) no coincide con la suma de los productos (${suma_lineas}).")
        return data

    def create(self, validated_data):
        # Solo guarda en la base local. La orden en Shopify y el descuento de
        # stock los hace ProcesarVentaView, una sola vez.
        detalles_data = validated_data.pop('detalles')
        venta = VentaLocal.objects.create(**validated_data)
        for detalle_data in detalles_data:
            # Guardamos la variante: se necesita para devoluciones
            detalle_data['shopify_variant_id'] = detalle_data.pop('id_shopify', None) or ''
            DetalleVenta.objects.create(venta=venta, **detalle_data)
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