import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('caja', '0009_documentos_tributarios'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name='PagoRemoto',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('idempotency_key', models.CharField(max_length=36, unique=True)),
                ('monto', models.PositiveIntegerField()),
                ('metodo', models.CharField(choices=[('DEBITO', 'Débito'), ('CREDITO', 'Crédito')], max_length=10)),
                ('dispositivo', models.CharField(max_length=40)),
                ('estado', models.CharField(choices=[('PENDIENTE', 'En cola'), ('ENVIADO', 'Esperando tarjeta en el POS'), ('PROCESANDO', 'Procesando'), ('COMPLETADO', 'Aprobado'), ('FALLIDO', 'Rechazado'), ('CANCELADO', 'Cancelado en el POS'), ('ERROR', 'No se pudo enviar')], default='PENDIENTE', max_length=12)),
                ('codigo_operacion', models.CharField(blank=True, max_length=40)),
                ('error', models.TextField(blank=True)),
                ('respuesta', models.JSONField(blank=True, default=dict)),
                ('creado', models.DateTimeField(auto_now_add=True)),
                ('consultado_en', models.DateTimeField(blank=True, null=True)),
                ('sesion', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='pagos_remotos', to='caja.sesioncaja')),
                ('usuario', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='pagos_remotos', to=settings.AUTH_USER_MODEL)),
                ('venta', models.OneToOneField(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='pago_remoto', to='caja.ventalocal')),
            ],
            options={'ordering': ['-creado']},
        ),
    ]
