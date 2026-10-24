"""
Historial de ventas de la caja (solo administradores).

GET /api/ventas/?desde=AAAA-MM-DD&hasta=AAAA-MM-DD&metodo_pago=EFECTIVO&q=texto&page=N
    Listado paginado, de la más reciente a la más antigua. Sin fechas: hoy.
    `q` busca por número de venta (#123) o por producto (nombre, SKU, código).
GET /api/ventas/resumen/?(mismos filtros)
    Totales del rango: ventas, unidades, descuentos y desglose por medio de pago.
GET /api/ventas/<id>/
    Detalle de una venta con sus productos.
"""
from django.conf import settings
from django.db.models import Count, F, Q, Sum
from rest_framework import generics, serializers, status
from rest_framework.pagination import PageNumberPagination
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .fechas import RangoInvalido, rango_del_dia
from .models import DetalleVenta, VentaLocal
from .permissions import IsAdmin


# ---------- Filtros comunes ----------

def ventas_filtradas(params):
    inicio, fin = rango_del_dia(params.get('desde'), params.get('hasta'))
    ventas = VentaLocal.objects.filter(fecha_hora__gte=inicio, fecha_hora__lt=fin)

    metodo = params.get('metodo_pago')
    if metodo:
        ventas = ventas.filter(metodo_pago=metodo)

    texto = (params.get('q') or '').strip()
    if texto:
        con_producto = DetalleVenta.objects.filter(
            Q(nombre_producto__icontains=texto) | Q(sku__icontains=texto) | Q(codigo_barras=texto)
        ).values('venta_id')
        condicion = Q(id__in=con_producto)
        numero = texto.lstrip('#')
        if numero.isdigit():
            condicion |= Q(id=int(numero))
        ventas = ventas.filter(condicion)
    return ventas


def _url_orden_shopify(order_gid):
    """Enlace a la orden en el admin de Shopify, o None si no se sincronizó."""
    if not order_gid:
        return None
    tienda = settings.SHOPIFY_STORE_URL.split('.')[0]
    return f"https://admin.shopify.com/store/{tienda}/orders/{str(order_gid).split('/')[-1]}"


# ---------- Serializers ----------

class VentaListadoSerializer(serializers.ModelSerializer):
    total = serializers.IntegerField()
    metodo_pago_nombre = serializers.CharField(source='get_metodo_pago_display')
    cajero = serializers.CharField(source='sesion.cajero.username')
    unidades = serializers.IntegerField()
    total_normal = serializers.IntegerField()
    descuento = serializers.SerializerMethodField()
    url_shopify = serializers.SerializerMethodField()

    class Meta:
        model = VentaLocal
        fields = ['id', 'fecha_hora', 'total', 'metodo_pago', 'metodo_pago_nombre', 'cajero',
                  'unidades', 'total_normal', 'descuento', 'sincronizado_shopify', 'url_shopify']

    def get_descuento(self, venta):
        return max(int(venta.total_normal or 0) - int(venta.total), 0)

    def get_url_shopify(self, venta):
        return _url_orden_shopify(venta.shopify_order_id)


class DetalleHistorialSerializer(serializers.ModelSerializer):
    total_normal = serializers.IntegerField(source='subtotal')
    total_cobrado = serializers.IntegerField()  # método del modelo (con descuentos)

    class Meta:
        model = DetalleVenta
        fields = ['id', 'nombre_producto', 'sku', 'codigo_barras', 'cantidad', 'precio_unitario',
                  'total_normal', 'total_cobrado', 'promocion']


class VentaDetalleSerializer(VentaListadoSerializer):
    monto_recibido = serializers.IntegerField(allow_null=True)
    vuelto = serializers.IntegerField(allow_null=True)
    detalles = DetalleHistorialSerializer(many=True)

    class Meta(VentaListadoSerializer.Meta):
        fields = VentaListadoSerializer.Meta.fields + ['monto_recibido', 'vuelto', 'detalles']


# ---------- Vistas ----------

class PaginacionVentas(PageNumberPagination):
    page_size = 50


def _con_totales(ventas):
    return ventas.select_related('sesion__cajero').annotate(
        unidades=Sum('detalles__cantidad'),
        total_normal=Sum(F('detalles__cantidad') * F('detalles__precio_unitario')),
    )


class VentaListView(generics.ListAPIView):
    permission_classes = [IsAuthenticated, IsAdmin]
    serializer_class = VentaListadoSerializer
    pagination_class = PaginacionVentas

    def list(self, request, *args, **kwargs):
        try:
            return super().list(request, *args, **kwargs)
        except RangoInvalido as e:
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)

    def get_queryset(self):
        return _con_totales(ventas_filtradas(self.request.query_params)).order_by('-fecha_hora', '-id')


class VentaDetailView(generics.RetrieveAPIView):
    permission_classes = [IsAuthenticated, IsAdmin]
    serializer_class = VentaDetalleSerializer

    def get_queryset(self):
        return _con_totales(VentaLocal.objects.all()).prefetch_related('detalles')


class ResumenVentasView(APIView):
    permission_classes = [IsAuthenticated, IsAdmin]

    def get(self, request):
        try:
            ventas = ventas_filtradas(request.query_params)
        except RangoInvalido as e:
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)

        totales = ventas.aggregate(cantidad=Count('id'), total=Sum('total'))
        lineas = DetalleVenta.objects.filter(venta__in=ventas).aggregate(
            unidades=Sum('cantidad'),
            total_normal=Sum(F('cantidad') * F('precio_unitario')),
        )
        nombres = dict(VentaLocal.METODOS_PAGO)
        por_metodo = [
            {"metodo_pago": f['metodo_pago'], "nombre": nombres.get(f['metodo_pago'], f['metodo_pago']),
             "cantidad": f['cantidad'], "total": int(f['total'] or 0)}
            for f in ventas.values('metodo_pago').annotate(cantidad=Count('id'), total=Sum('total')).order_by('-total')
        ]
        total = int(totales['total'] or 0)
        return Response({
            "cantidad_ventas": totales['cantidad'],
            "total": total,
            "unidades": int(lineas['unidades'] or 0),
            "descuentos": max(int(lineas['total_normal'] or 0) - total, 0),
            "ticket_promedio": round(total / totales['cantidad']) if totales['cantidad'] else 0,
            "por_metodo": por_metodo,
        })
