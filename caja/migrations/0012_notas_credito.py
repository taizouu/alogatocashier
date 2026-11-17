import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('caja', '0011_pago_remoto_estados'),
    ]

    operations = [
        migrations.AddField(
            model_name='documentotributario',
            name='devolucion',
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT,
                                    related_name='notas_credito', to='caja.devolucion'),
        ),
        migrations.AddField(
            model_name='documentotributario',
            name='referencia',
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT,
                                    related_name='notas_credito', to='caja.documentotributario'),
        ),
    ]
