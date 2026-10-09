from django.db import models
from django.contrib.auth.models import User
from django.db.models.signals import post_save
from django.dispatch import receiver


class PerfilUsuario(models.Model):
    ROL_CHOICES = [
        ('ADMIN', 'Administrador'),
        ('VENDEDOR', 'Vendedor'),
    ]

    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name='perfil')
    rol = models.CharField(max_length=20, choices=ROL_CHOICES, default='VENDEDOR')

    def __str__(self):
        return f"{self.user.username} - {self.get_rol_display()}"

    class Meta:
        verbose_name = 'Perfil de Usuario'
        verbose_name_plural = 'Perfiles de Usuarios'


def obtener_rol(user):
    """Rol efectivo del usuario. Un superusuario siempre es ADMIN."""
    if user.is_superuser:
        return 'ADMIN'
    perfil = getattr(user, 'perfil', None)
    return perfil.rol if perfil else 'VENDEDOR'


# Crear perfil automaticamente cuando se crea un usuario
# (o al guardar uno que ya existia antes de este sistema)
@receiver(post_save, sender=User)
def crear_perfil_usuario(sender, instance, **kwargs):
    rol_inicial = 'ADMIN' if instance.is_superuser else 'VENDEDOR'
    PerfilUsuario.objects.get_or_create(user=instance, defaults={'rol': rol_inicial})
