from rest_framework_simplejwt.serializers import TokenObtainPairSerializer


class CustomTokenObtainPairSerializer(TokenObtainPairSerializer):
    """
    Extiende el serializer de SimpleJWT para incluir el rol del usuario
    dentro del token JWT. Asi el frontend puede leer el rol sin hacer
    una peticion extra al backend.
    """

    @classmethod
    def get_token(cls, user):
        token = super().get_token(user)

        # Inyectamos claims personalizados en el token
        token['username'] = user.username
        token['rol'] = getattr(user, 'perfil', None) and user.perfil.rol or 'VENDEDOR'

        return token
