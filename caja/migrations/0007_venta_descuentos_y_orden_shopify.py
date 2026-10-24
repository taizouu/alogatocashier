from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('caja', '0006_promociones_grupos'),
    ]

    operations = [
        migrations.AddField(
            model_name='ventalocal',
            name='shopify_order_id',
            field=models.CharField(blank=True, max_length=100, null=True),
        ),
        migrations.AddField(
            model_name='detalleventa',
            name='total_linea',
            field=models.IntegerField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='detalleventa',
            name='promocion',
            field=models.CharField(blank=True, default='', max_length=255),
        ),
        migrations.AlterField(
            model_name='detalleventa',
            name='precio_unitario',
            field=models.IntegerField(help_text='Precio normal por unidad'),
        ),
    ]
