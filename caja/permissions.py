from rest_framework.permissions import BasePermission
from usuarios.models import obtener_rol


class IsAdmin(BasePermission):
    """
    Permite acceso solo a usuarios con rol ADMIN (o superusuarios).
    Se usa en vistas que no deben ser accesibles por vendedores.
    """

    def has_permission(self, request, view):
        if not request.user or not request.user.is_authenticated:
            return False

        return obtener_rol(request.user) == 'ADMIN'
