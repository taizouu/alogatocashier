from django.urls import path
from rest_framework_simplejwt.views import TokenRefreshView
from .views import CustomTokenObtainPairView, UsuarioListCreateView, UsuarioDetailView

urlpatterns = [
    # Login con JWT que incluye el rol del usuario en el token
    path('login/', CustomTokenObtainPairView.as_view(), name='token_obtain_pair'),
    path('refresh/', TokenRefreshView.as_view(), name='token_refresh'),

    # Gestión de usuarios (solo admin)
    path('usuarios/', UsuarioListCreateView.as_view(), name='usuario_list_create'),
    path('usuarios/<int:pk>/', UsuarioDetailView.as_view(), name='usuario_detail'),
]
