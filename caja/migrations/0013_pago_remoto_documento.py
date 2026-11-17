from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('caja', '0012_notas_credito'),
    ]

    operations = [
        migrations.AddField(
            model_name='pagoremoto',
            name='documento',
            field=models.CharField(choices=[('BOLETA', 'Boleta'), ('FACTURA', 'Factura')], default='BOLETA', max_length=10),
        ),
    ]
