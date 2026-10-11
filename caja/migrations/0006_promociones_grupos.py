from django.db import migrations, models


def convertir_a_grupos(apps, schema_editor):
    """
    Convierte cada promoción antigua (un solo filtro alcance_tipo/alcance_valor
    y una cantidad_requerida) en una promoción con un único grupo.
    """
    PromocionLocal = apps.get_model('caja', 'PromocionLocal')
    for promo in PromocionLocal.objects.all():
        campo = promo.alcance_tipo if promo.alcance_tipo in ('SKU', 'PROVEEDOR', 'TIPO') else 'SKU'
        promo.grupos = [{
            'cantidad': max(int(promo.cantidad_requerida or 1), 1),
            'condiciones': [{'campo': campo, 'valores': [promo.alcance_valor]}],
        }]
        promo.save(update_fields=['grupos'])


def revertir_desde_grupos(apps, schema_editor):
    """Al revertir conservamos solo la primera condición del primer grupo."""
    PromocionLocal = apps.get_model('caja', 'PromocionLocal')
    for promo in PromocionLocal.objects.all():
        grupo = (promo.grupos or [{}])[0]
        condicion = (grupo.get('condiciones') or [{}])[0]
        campo = condicion.get('campo', 'SKU')
        promo.alcance_tipo = campo if campo in ('SKU', 'PROVEEDOR', 'TIPO') else 'SKU'
        promo.alcance_valor = (condicion.get('valores') or ['N/A'])[0][:100]
        promo.cantidad_requerida = grupo.get('cantidad', 1)
        if promo.tipo_promocion == 'PORCENTAJE':
            promo.tipo_promocion = 'VOLUMEN'
        promo.save()


class Migration(migrations.Migration):

    dependencies = [
        ('caja', '0005_remove_promocionlocal_sku_producto_and_more'),
    ]

    operations = [
        # 1. Campos nuevos
        migrations.AddField(
            model_name='promocionlocal',
            name='grupos',
            field=models.JSONField(default=list, help_text='Grupos de productos que componen la promoción'),
        ),
        migrations.AddField(
            model_name='promocionlocal',
            name='porcentaje_descuento',
            field=models.PositiveSmallIntegerField(blank=True, help_text='PORCENTAJE: 1 a 100', null=True),
        ),
        # 2. Los campos antiguos pasan a opcionales para poder revertir la migración sin errores
        migrations.AlterField(
            model_name='promocionlocal',
            name='cantidad_requerida',
            field=models.IntegerField(default=1),
        ),
        migrations.AlterField(
            model_name='promocionlocal',
            name='alcance_valor',
            field=models.CharField(default='N/A', max_length=100),
        ),
        # 3. Copiar los datos existentes al formato nuevo
        migrations.RunPython(convertir_a_grupos, revertir_desde_grupos),
        # 4. Eliminar los campos antiguos
        migrations.RemoveField(model_name='promocionlocal', name='alcance_tipo'),
        migrations.RemoveField(model_name='promocionlocal', name='alcance_valor'),
        migrations.RemoveField(model_name='promocionlocal', name='cantidad_requerida'),
        # 5. Ajustes de choices y textos de ayuda
        migrations.AlterField(
            model_name='promocionlocal',
            name='tipo_promocion',
            field=models.CharField(
                choices=[
                    ('VOLUMEN', 'Precio fijo por pack o combo (Ej: 3 por $10.000)'),
                    ('PORCENTAJE', 'Descuento % al completar el pack o combo'),
                    ('N_X_M', 'Llevas N y pagas M (Ej: 3x2)'),
                    ('POR_MAYOR', 'Precio unitario rebajado desde X unidades'),
                ],
                default='VOLUMEN', max_length=20,
            ),
        ),
        migrations.AlterField(
            model_name='promocionlocal',
            name='precio_promocional',
            field=models.IntegerField(blank=True, help_text='VOLUMEN: precio del pack. POR_MAYOR: precio por unidad', null=True),
        ),
        migrations.AlterField(
            model_name='promocionlocal',
            name='cantidad_pagada',
            field=models.IntegerField(blank=True, help_text='N_X_M: unidades que se pagan', null=True),
        ),
    ]
