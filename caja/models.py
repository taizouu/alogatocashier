from django.db import models
from django.contrib.auth.models import User
from django.utils import timezone

class SesionCaja(models.Model):
    """
    Controla el flujo de dinero físico (Apertura y Cierre / Reporte Z)
    """
    ESTADO_CHOICES = [
        ('ABIERTA', 'Abierta'),
        ('CERRADA', 'Cerrada'),
    ]

    cajero = models.ForeignKey(User, on_delete=models.PROTECT)
    fecha_apertura = models.DateTimeField(auto_now_add=True)
    fecha_cierre = models.DateTimeField(null=True, blank=True)
    
    monto_apertura = models.IntegerField(help_text="Fondo de caja inicial en efectivo")
    monto_cierre_esperado = models.IntegerField(null=True, blank=True)
    monto_cierre_real = models.IntegerField(null=True, blank=True)
    
    estado = models.CharField(max_length=10, choices=ESTADO_CHOICES, default='ABIERTA')

    def __str__(self):
        return f"Sesión {self.id} - {self.cajero.username} ({self.estado})"

class VentaLocal(models.Model):
    METODOS_PAGO = [
        ('EFECTIVO', 'Efectivo'),
        ('TARJETA_TUU', 'Tarjeta TUU'),
        ('TRANSFERENCIA', 'Transferencia'),
    ]

    sesion = models.ForeignKey(SesionCaja, on_delete=models.CASCADE, related_name='ventas')
    fecha_hora = models.DateTimeField(auto_now_add=True)
    total = models.DecimalField(max_digits=10, decimal_places=2)
    metodo_pago = models.CharField(choices=METODOS_PAGO, default='EFECTIVO', max_length=20)
    monto_recibido = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    vuelto = models.DecimalField(max_digits=10, decimal_places=2, default=0, null=True, blank=True)
    
    sincronizado_shopify = models.BooleanField(default=False)
    
    def __str__(self):
        return f"Venta {self.id} - ${self.total} ({self.metodo_pago})"

class DetalleVenta(models.Model):
    """
    Los artículos exactos (latas, boquillas, marcadores) escaneados en una venta.
    """
    venta = models.ForeignKey(VentaLocal, on_delete=models.CASCADE, related_name='detalles')
    codigo_barras = models.CharField(max_length=100)
    sku = models.CharField(max_length=100, null=True, blank=True)
    nombre_producto = models.CharField(max_length=255)
    cantidad = models.IntegerField(default=1)
    precio_unitario = models.IntegerField()

    def subtotal(self):
        return self.cantidad * self.precio_unitario

    def __str__(self):
        return f"{self.cantidad}x {self.nombre_producto} (Venta {self.venta.id})"

class PromocionLocal(models.Model):
    TIPO_PROMO_CHOICES = [
        ('VOLUMEN', 'Precio especial por X cantidad (Ej: 3x10000)'),
        ('N_X_M', 'Llevas N y Pagas M (Ej: 3x2)'),
        ('POR_MAYOR', 'Precio rebajado desde X unidades'),
    ]

    ALCANCE_CHOICES = [
        ('SKU', 'SKU Específico'),
        ('PROVEEDOR', 'Proveedor (Vendor)'),
        ('TIPO', 'Tipo de Producto (Categoría)'),
    ]

    nombre = models.CharField(max_length=100, help_text="Ej: Promo 3 Latas Motta")
    
    # NUEVOS CAMPOS QUE REEMPLAZAN A sku_producto
    alcance_tipo = models.CharField(max_length=20, choices=ALCANCE_CHOICES, default='SKU')
    alcance_valor = models.CharField(max_length=100, help_text="El SKU exacto, el nombre del Proveedor o el Tipo de producto")
    
    tipo_promocion = models.CharField(max_length=20, choices=TIPO_PROMO_CHOICES, default='VOLUMEN')
    cantidad_requerida = models.IntegerField()
    precio_promocional = models.IntegerField(null=True, blank=True)
    cantidad_pagada = models.IntegerField(null=True, blank=True)
    fecha_inicio = models.DateTimeField(default=timezone.now)
    fecha_fin = models.DateTimeField(null=True, blank=True)
    activa = models.BooleanField(default=True)

    def __str__(self):
        return f"{self.nombre} ({self.get_alcance_tipo_display()}: {self.alcance_valor})"