from django.conf import settings
from django.db import migrations


def crear_perfiles(apps, schema_editor):
    """
    Crea el perfil de los usuarios que existian antes del sistema de roles
    y deja a los superusuarios como ADMIN.
    """
    app_label, model_name = settings.AUTH_USER_MODEL.split('.')
    User = apps.get_model(app_label, model_name)
    PerfilUsuario = apps.get_model('usuarios', 'PerfilUsuario')

    for user in User.objects.all():
        rol = 'ADMIN' if user.is_superuser else 'VENDEDOR'
        perfil, creado = PerfilUsuario.objects.get_or_create(user=user, defaults={'rol': rol})
        if not creado and user.is_superuser and perfil.rol != 'ADMIN':
            perfil.rol = 'ADMIN'
            perfil.save()


class Migration(migrations.Migration):

    dependencies = [
        ('usuarios', '0001_initial'),
    ]

    operations = [
        migrations.RunPython(crear_perfiles, migrations.RunPython.noop),
    ]
