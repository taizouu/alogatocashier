from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('caja', '0010_pago_remoto'),
    ]

    operations = [
        migrations.AlterField(
            model_name='pagoremoto',
            name='estado',
            field=models.CharField(choices=[('PENDIENTE', 'En cola'), ('ENVIADO', 'Esperando tarjeta en el POS'), ('PROCESANDO', 'Procesando'), ('COMPLETADO', 'Aprobado'), ('FALLIDO', 'Rechazado'), ('CANCELADO', 'Cancelado en el POS'), ('ERROR', 'No se pudo enviar'), ('REVISAR', 'Aprobado con monto distinto'), ('DESCARTADO', 'Descartado (anulado en el POS)')], default='PENDIENTE', max_length=12),
        ),
    ]
