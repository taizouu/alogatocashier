from django.urls import path
from .views import BuscarProductoView, ProcesarVentaView, AbrirSesionCajaView, BuscarProductoNombreView

urlpatterns = [
    path('buscar-producto/', BuscarProductoView.as_view(), name='buscar_producto'),
    path('procesar-venta/', ProcesarVentaView.as_view(), name='procesar_venta'),
    path('abrir-caja/', AbrirSesionCajaView.as_view(), name='abrir_caja'),
    path('buscar-producto-nombre/', BuscarProductoNombreView.as_view(), name='buscar_producto_nombre'),
]