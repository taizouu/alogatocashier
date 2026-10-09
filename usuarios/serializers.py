from rest_framework_simplejwt.serializers import TokenObtainPairSerializer
from rest_framework import serializers
from django.contrib.auth.models import User
from .models import PerfilUsuario


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


class UsuarioSerializer(serializers.ModelSerializer):
    """
    Serializer para gestionar usuarios desde el panel de administración.
    Incluye el rol del perfil y permite crear/editar usuarios con contraseña.
    """
    rol = serializers.CharField(source='perfil.rol', default='VENDEDOR')
    password = serializers.CharField(write_only=True, required=False, min_length=6)

    class Meta:
        model = User
        fields = ['id', 'username', 'first_name', 'last_name', 'email', 'is_active', 'rol', 'password']

    def create(self, validated_data):
        perfil_data = validated_data.pop('perfil', {})
        password = validated_data.pop('password')

        user = User.objects.create_user(
            password=password,
            **validated_data
        )

        # La señal post_save ya crea el perfil con rol VENDEDOR,
        # pero si se especificó otro rol, lo actualizamos
        rol = perfil_data.get('rol', 'VENDEDOR')
        if rol != 'VENDEDOR':
            user.perfil.rol = rol
            user.perfil.save()

        return user

    def update(self, instance, validated_data):
        perfil_data = validated_data.pop('perfil', {})
        password = validated_data.pop('password', None)

        # Actualizar campos del User
        for attr, value in validated_data.items():
            setattr(instance, attr, value)

        if password:
            instance.set_password(password)

        instance.save()

        # Actualizar rol del perfil
        if 'rol' in perfil_data:
            instance.perfil.rol = perfil_data['rol']
            instance.perfil.save()

        return instance
