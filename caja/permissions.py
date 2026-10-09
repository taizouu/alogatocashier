from rest_framework.permissions import BasePermission


class IsAdmin(BasePermission):
    """
    Permite acceso solo a usuarios con rol ADMIN.
    Se usa en vistas que no deben ser accesibles por vendedores.
    """

    def has_permission(self, request, view):
        if not request.user or not request.user.is_authenticated:
            return False

        perfil = getattr(request.user, 'perfil', None)
        if perfil is None:
            return False

        return perfil.rol == 'ADMIN'
