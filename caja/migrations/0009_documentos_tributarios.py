import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('caja', '0008_devoluciones'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name='DocumentoTributario',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('tipo', models.PositiveSmallIntegerField(choices=[(39, 'Boleta electrónica'), (33, 'Factura electrónica'), (61, 'Nota de crédito')])),
                ('estado', models.CharField(choices=[('PENDIENTE', 'Enviando'), ('EMITIDO', 'Emitido'), ('ERROR', 'Con error')], default='PENDIENTE', max_length=10)),
                ('ambiente', models.CharField(help_text='dev (pruebas, no llega al SII) o prod', max_length=4)),
                ('folio', models.PositiveIntegerField(blank=True, null=True)),
                ('token', models.CharField(blank=True, default='', max_length=128)),
                ('idempotency_key', models.CharField(max_length=100, unique=True)),
                ('monto_total', models.IntegerField(help_text='Total del documento')),
                ('diferencia', models.IntegerField(default=0, help_text='Total del documento - total cobrado (redondeo IVA)')),
                ('receptor_rut', models.CharField(blank=True, default='', max_length=12)),
                ('receptor_razon_social', models.CharField(blank=True, default='', max_length=100)),
                ('receptor', models.JSONField(blank=True, default=dict, help_text='Datos del cliente (factura)')),
                ('email', models.EmailField(blank=True, default='', help_text='Correo al que se envía el documento', max_length=254)),
                ('estado_sii', models.CharField(blank=True, default='', max_length=30)),
                ('error', models.TextField(blank=True, default='')),
                ('advertencia', models.CharField(blank=True, default='', max_length=500)),
                ('intentos', models.PositiveSmallIntegerField(default=0)),
                ('intentado_en', models.DateTimeField(blank=True, null=True)),
                ('sin_respuesta', models.BooleanField(default=False)),
                ('creado', models.DateTimeField(auto_now_add=True)),
                ('emitido_en', models.DateTimeField(blank=True, null=True)),
                ('usuario', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, to=settings.AUTH_USER_MODEL)),
                ('venta', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='documentos', to='caja.ventalocal')),
            ],
            options={
                'verbose_name': 'Documento tributario',
                'verbose_name_plural': 'Documentos tributarios',
                'ordering': ['-creado'],
            },
        ),
    ]
