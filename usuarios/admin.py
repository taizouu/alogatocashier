from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin
from django.contrib.auth.models import User
from .models import PerfilUsuario


class PerfilUsuarioInline(admin.StackedInline):
    """Muestra el perfil dentro de la pagina de edicion del usuario."""
    model = PerfilUsuario
    can_delete = False
    verbose_name = 'Perfil'
    verbose_name_plural = 'Perfil'


class UserAdmin(BaseUserAdmin):
    """Extiende el admin de User para incluir el selector de rol."""
    inlines = [PerfilUsuarioInline]


# Re-registrar User con nuestro admin extendido
admin.site.unregister(User)
admin.site.register(User, UserAdmin)
