from django.urls import path
from .views import IngresarFacturaView, ProveedorListCreateView, HistorialFacturasView

urlpatterns = [
    path('ingresar/', IngresarFacturaView.as_view(), name='ingresar_factura'),
    path('proveedores/', ProveedorListCreateView.as_view(), name='listar_crear_proveedores'),
    path('facturas/', HistorialFacturasView.as_view(), name='historial-facturas'),
]