from django.urls import path
from .views import (
    BuscarProductoView, ProcesarVentaView, AbrirSesionCajaView,
    BuscarProductoNombreView, PromocionActivaListView, PromocionListCreateView,
    PromocionDetailView, EstadoCajaView, CerrarSesionCajaView
)

urlpatterns = [
    path('buscar-producto/', BuscarProductoView.as_view(), name='buscar_producto'),
    path('procesar-venta/', ProcesarVentaView.as_view(), name='procesar_venta'),
    path('abrir-caja/', AbrirSesionCajaView.as_view(), name='abrir_caja'),
    path('cerrar-caja/', CerrarSesionCajaView.as_view(), name='cerrar_caja'),
    path('estado-caja/', EstadoCajaView.as_view(), name='estado_caja'),
    path('buscar-producto-nombre/', BuscarProductoNombreView.as_view(), name='buscar_producto_nombre'),
    path('promociones-activas/', PromocionActivaListView.as_view(), name='promociones-activas'),
    path('promociones/', PromocionListCreateView.as_view(), name='promociones-gestion'),
    path('promociones/<int:pk>/', PromocionDetailView.as_view(), name='promociones-detalle'),
]
