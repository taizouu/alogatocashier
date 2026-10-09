from rest_framework_simplejwt.views import TokenObtainPairView
from rest_framework import generics
from rest_framework.permissions import IsAuthenticated
from django.contrib.auth.models import User
from .serializers import CustomTokenObtainPairSerializer, UsuarioSerializer
from caja.permissions import IsAdmin


class CustomTokenObtainPairView(TokenObtainPairView):
    """
    Vista de login que usa nuestro serializer custom para incluir
    el rol del usuario en el JWT.
    """
    serializer_class = CustomTokenObtainPairSerializer


class UsuarioListCreateView(generics.ListCreateAPIView):
    """
    GET: Lista todos los usuarios con su rol.
    POST: Crea un nuevo usuario con rol asignado.
    Solo accesible por administradores.
    """
    permission_classes = [IsAuthenticated, IsAdmin]
    queryset = User.objects.select_related('perfil').all().order_by('username')
    serializer_class = UsuarioSerializer


class UsuarioDetailView(generics.RetrieveUpdateDestroyAPIView):
    """
    GET: Detalle de un usuario.
    PUT/PATCH: Actualizar usuario (nombre, rol, contraseña, estado).
    DELETE: Desactivar usuario (no elimina, solo is_active=False).
    Solo accesible por administradores.
    """
    permission_classes = [IsAuthenticated, IsAdmin]
    queryset = User.objects.select_related('perfil').all()
    serializer_class = UsuarioSerializer

    def perform_destroy(self, instance):
        # No eliminamos, solo desactivamos
        instance.is_active = False
        instance.save()
