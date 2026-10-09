from rest_framework_simplejwt.views import TokenObtainPairView
from .serializers import CustomTokenObtainPairSerializer


class CustomTokenObtainPairView(TokenObtainPairView):
    """
    Vista de login que usa nuestro serializer custom para incluir
    el rol del usuario en el JWT.
    """
    serializer_class = CustomTokenObtainPairSerializer
