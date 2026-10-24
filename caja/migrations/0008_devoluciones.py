import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('caja', '0007_venta_descuentos_y_orden_shopify'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.AddField(
            model_name='detalleventa',
            name='shopify_variant_id',
            field=models.CharField(blank=True, default='', max_length=100),
        ),
        migrations.CreateModel(
            name='Devolucion',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('fecha_hora', models.DateTimeField(auto_now_add=True)),
                ('motivo', models.CharField(max_length=255)),
                ('metodo_reembolso', models.CharField(choices=[('EFECTIVO', 'Efectivo'), ('TARJETA_TUU', 'Tarjeta TUU'), ('TRANSFERENCIA', 'Transferencia')], max_length=20)),
                ('total', models.IntegerField(help_text='Monto reembolsado al cliente')),
                ('repone_stock', models.BooleanField(default=True)),
                ('es_anulacion', models.BooleanField(default=False)),
                ('sincronizado_shopify', models.BooleanField(default=False)),
                ('shopify_refund_id', models.CharField(blank=True, default='', max_length=100)),
                ('aviso_shopify', models.CharField(blank=True, default='', max_length=500)),
                ('sesion', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT, related_name='devoluciones', to='caja.sesioncaja')),
                ('usuario', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, to=settings.AUTH_USER_MODEL)),
                ('venta', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='devoluciones', to='caja.ventalocal')),
            ],
            options={
                'verbose_name': 'Devolución',
                'verbose_name_plural': 'Devoluciones',
            },
        ),
        migrations.CreateModel(
            name='DetalleDevolucion',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('cantidad', models.PositiveIntegerField()),
                ('monto', models.IntegerField(help_text='Reembolso por estas unidades')),
                ('detalle_venta', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='devoluciones', to='caja.detalleventa')),
                ('devolucion', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='detalles', to='caja.devolucion')),
            ],
        ),
    ]
