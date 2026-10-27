from django.urls import path
from .views import (
    BuscarProductoView, ProcesarVentaView, AbrirSesionCajaView,
    BuscarProductoNombreView, PromocionActivaListView, PromocionListCreateView,
    PromocionDetailView, EstadoCajaView, CerrarSesionCajaView, OpcionesPromocionView,
    AccesoRapidoView,
)
from .historial import VentaListView, VentaDetailView, ResumenVentasView, ComprobanteVentaView
from .devoluciones import CrearDevolucionView
from .documentos import (ConfiguracionDocumentosView, DocumentoListView, ReintentarDocumentoView,
                         EstadoDocumentoView, PdfDocumentoView, ContribuyenteView)

urlpatterns = [
    path('buscar-producto/', BuscarProductoView.as_view(), name='buscar_producto'),
    path('procesar-venta/', ProcesarVentaView.as_view(), name='procesar_venta'),
    path('abrir-caja/', AbrirSesionCajaView.as_view(), name='abrir_caja'),
    path('cerrar-caja/', CerrarSesionCajaView.as_view(), name='cerrar_caja'),
    path('estado-caja/', EstadoCajaView.as_view(), name='estado_caja'),
    path('buscar-producto-nombre/', BuscarProductoNombreView.as_view(), name='buscar_producto_nombre'),
    path('acceso-rapido/', AccesoRapidoView.as_view(), name='acceso_rapido'),
    path('promociones-activas/', PromocionActivaListView.as_view(), name='promociones-activas'),
    path('promociones/', PromocionListCreateView.as_view(), name='promociones-gestion'),
    path('promociones/<int:pk>/', PromocionDetailView.as_view(), name='promociones-detalle'),
    path('promociones/opciones/', OpcionesPromocionView.as_view(), name='promociones-opciones'),
    path('ventas/', VentaListView.as_view(), name='ventas-historial'),
    path('ventas/resumen/', ResumenVentasView.as_view(), name='ventas-resumen'),
    path('ventas/<int:pk>/', VentaDetailView.as_view(), name='ventas-detalle'),
    path('ventas/<int:pk>/devoluciones/', CrearDevolucionView.as_view(), name='ventas-devolucion'),
    path('ventas/<int:pk>/comprobante/', ComprobanteVentaView.as_view(), name='ventas-comprobante'),
    path('documentos/', DocumentoListView.as_view(), name='documentos'),
    path('documentos/configuracion/', ConfiguracionDocumentosView.as_view(), name='documentos-configuracion'),
    path('documentos/<int:pk>/reintentar/', ReintentarDocumentoView.as_view(), name='documentos-reintentar'),
    path('documentos/<int:pk>/estado/', EstadoDocumentoView.as_view(), name='documentos-estado'),
    path('documentos/<int:pk>/pdf/', PdfDocumentoView.as_view(), name='documentos-pdf'),
    path('contribuyente/<str:rut>/', ContribuyenteView.as_view(), name='contribuyente'),
]
