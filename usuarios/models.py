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


# Crear perfil automaticamente cuando se crea un usuario
@receiver(post_save, sender=User)
def crear_perfil_usuario(sender, instance, created, **kwargs):
    if created:
        PerfilUsuario.objects.create(user=instance)


@receiver(post_save, sender=User)
def guardar_perfil_usuario(sender, instance, **kwargs):
    # Si el usuario ya existia antes de este sistema, creamos su perfil
    if not hasattr(instance, 'perfil'):
        PerfilUsuario.objects.create(user=instance)
