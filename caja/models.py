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
    # ID de la orden en Shopify (gid://shopify/Order/...), necesario para devoluciones
    shopify_order_id = models.CharField(max_length=100, null=True, blank=True)
    
    def __str__(self):
        return f"Venta {self.id} - ${self.total} ({self.metodo_pago})"

class DetalleVenta(models.Model):
    """
    Los artículos exactos (latas, boquillas, marcadores) escaneados en una venta.
    """
    venta = models.ForeignKey(VentaLocal, on_delete=models.CASCADE, related_name='detalles')
    codigo_barras = models.CharField(max_length=100)
    sku = models.CharField(max_length=100, null=True, blank=True)
    # Variante vendida (gid://shopify/ProductVariant/...). Vacío en ventas antiguas.
    shopify_variant_id = models.CharField(max_length=100, blank=True, default='')
    nombre_producto = models.CharField(max_length=255)
    cantidad = models.IntegerField(default=1)
    precio_unitario = models.IntegerField(help_text="Precio normal por unidad")
    # Lo que realmente se cobró por la línea (con promociones). Null en ventas antiguas.
    total_linea = models.IntegerField(null=True, blank=True)
    promocion = models.CharField(max_length=255, blank=True, default='')

    def subtotal(self):
        """Precio normal de la línea, sin descuentos."""
        return self.cantidad * self.precio_unitario

    def total_cobrado(self):
        """Lo que pagó el cliente por la línea (ventas antiguas: precio normal)."""
        return self.total_linea if self.total_linea is not None else self.subtotal()

    def __str__(self):
        return f"{self.cantidad}x {self.nombre_producto} (Venta {self.venta.id})"

# Campos del producto por los que se puede filtrar una promoción.
# Las claves deben coincidir con el motor de promociones del frontend
# (pos_frontend/src/utils/promociones.js).
CAMPOS_FILTRO_PROMO = {
    'PROVEEDOR': 'Proveedor / Marca',
    'TIPO': 'Tipo de producto',
    'ETIQUETA': 'Etiqueta',
    'NOMBRE': 'Nombre contiene',
    'VARIANTE': 'Variante contiene (color, tamaño...)',
    'SKU': 'SKU',
    'CODIGO_BARRAS': 'Código de barras',
}


class PromocionLocal(models.Model):
    """
    Una promoción se compone de uno o más GRUPOS. Cada grupo pide una
    cantidad de unidades que cumplan TODAS sus condiciones. Dentro de una
    condición, basta con que el producto coincida con UNO de los valores.

    Ejemplo "3 Motta + 2 Rust-Oleum por $15.000":
        grupos = [
            {"cantidad": 3, "condiciones": [{"campo": "PROVEEDOR", "valores": ["Motta"]}]},
            {"cantidad": 2, "condiciones": [{"campo": "PROVEEDOR", "valores": ["Rust-Oleum"]}]},
        ]
    """
    TIPO_PROMO_CHOICES = [
        ('VOLUMEN', 'Precio fijo por pack o combo (Ej: 3 por $10.000)'),
        ('PORCENTAJE', 'Descuento % al completar el pack o combo'),
        ('N_X_M', 'Llevas N y pagas M (Ej: 3x2)'),
        ('POR_MAYOR', 'Precio unitario rebajado desde X unidades'),
    ]
    # Tipos que admiten varios grupos (combos)
    TIPOS_COMBO = ('VOLUMEN', 'PORCENTAJE')

    nombre = models.CharField(max_length=100, help_text="Ej: Promo 3 Latas Motta")
    tipo_promocion = models.CharField(max_length=20, choices=TIPO_PROMO_CHOICES, default='VOLUMEN')
    grupos = models.JSONField(default=list, help_text="Grupos de productos que componen la promoción")

    # Según el tipo se usa uno u otro
    precio_promocional = models.IntegerField(null=True, blank=True,
                                             help_text="VOLUMEN: precio del pack. POR_MAYOR: precio por unidad")
    cantidad_pagada = models.IntegerField(null=True, blank=True, help_text="N_X_M: unidades que se pagan")
    porcentaje_descuento = models.PositiveSmallIntegerField(null=True, blank=True,
                                                            help_text="PORCENTAJE: 1 a 100")

    fecha_inicio = models.DateTimeField(default=timezone.now)
    fecha_fin = models.DateTimeField(null=True, blank=True)
    activa = models.BooleanField(default=True)

    def __str__(self):
        return f"{self.nombre} ({self.get_tipo_promocion_display()})"

class Devolucion(models.Model):
    """
    Devolución de productos de una venta (total o parcial). Una anulación es
    una devolución de todo lo que quedaba por devolver.
    El monto reembolsado es lo que el cliente pagó realmente por esas
    unidades (con promociones), no el precio de lista.
    """
    venta = models.ForeignKey(VentaLocal, on_delete=models.PROTECT, related_name='devoluciones')
    # Sesión de caja en la que se entregó el reembolso (afecta el cierre si es en efectivo)
    sesion = models.ForeignKey(SesionCaja, on_delete=models.PROTECT, null=True, blank=True,
                               related_name='devoluciones')
    usuario = models.ForeignKey(User, on_delete=models.PROTECT)
    fecha_hora = models.DateTimeField(auto_now_add=True)
    motivo = models.CharField(max_length=255)
    metodo_reembolso = models.CharField(max_length=20, choices=VentaLocal.METODOS_PAGO)
    total = models.IntegerField(help_text="Monto reembolsado al cliente")
    repone_stock = models.BooleanField(default=True)
    es_anulacion = models.BooleanField(default=False)

    sincronizado_shopify = models.BooleanField(default=False)
    shopify_refund_id = models.CharField(max_length=100, blank=True, default='')
    aviso_shopify = models.CharField(max_length=500, blank=True, default='')

    class Meta:
        verbose_name = 'Devolución'
        verbose_name_plural = 'Devoluciones'

    def __str__(self):
        return f"Devolución #{self.id} de venta #{self.venta_id} (${self.total})"


class DetalleDevolucion(models.Model):
    devolucion = models.ForeignKey(Devolucion, on_delete=models.CASCADE, related_name='detalles')
    detalle_venta = models.ForeignKey(DetalleVenta, on_delete=models.PROTECT, related_name='devoluciones')
    cantidad = models.PositiveIntegerField()
    monto = models.IntegerField(help_text="Reembolso por estas unidades")

    def __str__(self):
        return f"{self.cantidad}x {self.detalle_venta.nombre_producto}"


class DocumentoTributario(models.Model):
    """
    Registro de cada boleta o factura electrónica que la caja emite por
    OpenFactura (Haulmer). Sirve para reimprimir o reenviar, reintentar sin
    duplicar (clave de idempotencia), cuadrar lo emitido con lo vendido y,
    más adelante, referenciar el folio en notas de crédito.
    Las ventas con tarjeta no aparecen aquí: su boleta la emite el POS TUU.
    """
    TIPOS = [(39, 'Boleta electrónica'), (33, 'Factura electrónica'), (61, 'Nota de crédito')]
    ESTADOS = [
        ('PENDIENTE', 'Enviando'),      # se creó el registro y se está llamando a la API
        ('EMITIDO', 'Emitido'),         # OpenFactura lo recibió y asignó folio
        ('ERROR', 'Con error'),         # no se emitió; se puede reintentar
    ]

    venta = models.ForeignKey(VentaLocal, on_delete=models.PROTECT, related_name='documentos')
    tipo = models.PositiveSmallIntegerField(choices=TIPOS)
    estado = models.CharField(max_length=10, choices=ESTADOS, default='PENDIENTE')
    ambiente = models.CharField(max_length=4, help_text="dev (pruebas, no llega al SII) o prod")

    folio = models.PositiveIntegerField(null=True, blank=True)
    token = models.CharField(max_length=128, blank=True, default='')
    idempotency_key = models.CharField(max_length=100, unique=True)

    monto_total = models.IntegerField(help_text="Total del documento")
    diferencia = models.IntegerField(default=0, help_text="Total del documento - total cobrado (redondeo IVA)")

    receptor_rut = models.CharField(max_length=12, blank=True, default='')
    receptor_razon_social = models.CharField(max_length=100, blank=True, default='')
    receptor = models.JSONField(default=dict, blank=True, help_text="Datos del cliente (factura)")
    email = models.EmailField(blank=True, default='', help_text="Correo al que se envía el documento")

    estado_sii = models.CharField(max_length=30, blank=True, default='')
    error = models.TextField(blank=True, default='')
    advertencia = models.CharField(max_length=500, blank=True, default='')
    intentos = models.PositiveSmallIntegerField(default=0)
    # Último envío a OpenFactura (para detectar envíos que quedaron a medias)
    intentado_en = models.DateTimeField(null=True, blank=True)
    # El último intento no tuvo respuesta: el documento pudo emitirse igual
    sin_respuesta = models.BooleanField(default=False)

    usuario = models.ForeignKey(User, on_delete=models.PROTECT)
    creado = models.DateTimeField(auto_now_add=True)
    emitido_en = models.DateTimeField(null=True, blank=True)

    class Meta:
        verbose_name = 'Documento tributario'
        verbose_name_plural = 'Documentos tributarios'
        ordering = ['-creado']

    def __str__(self):
        folio = f"N° {self.folio}" if self.folio else self.get_estado_display()
        return f"{self.get_tipo_display()} {folio} (venta #{self.venta_id})"


class PagoRemoto(models.Model):
    """
    Cobro con tarjeta enviado desde la caja al POS TUU (Pago remoto).
    Se crea ANTES de la venta: la venta solo se registra cuando el POS
    confirma el pago (estado COMPLETADO) y queda enlazada aquí.
    """
    METODOS = [('DEBITO', 'Débito'), ('CREDITO', 'Crédito')]
    ESTADOS = [
        ('PENDIENTE', 'En cola'),
        ('ENVIADO', 'Esperando tarjeta en el POS'),
        ('PROCESANDO', 'Procesando'),
        ('COMPLETADO', 'Aprobado'),
        ('FALLIDO', 'Rechazado'),
        ('CANCELADO', 'Cancelado en el POS'),
        ('ERROR', 'No se pudo enviar'),
    ]

    sesion = models.ForeignKey(SesionCaja, on_delete=models.PROTECT, related_name='pagos_remotos')
    usuario = models.ForeignKey(User, on_delete=models.PROTECT, related_name='pagos_remotos')
    venta = models.OneToOneField(VentaLocal, on_delete=models.SET_NULL, null=True, blank=True,
                                 related_name='pago_remoto')
    idempotency_key = models.CharField(max_length=36, unique=True)
    monto = models.PositiveIntegerField()
    metodo = models.CharField(max_length=10, choices=METODOS)
    dispositivo = models.CharField(max_length=40)
    estado = models.CharField(max_length=12, choices=ESTADOS, default='PENDIENTE')
    # N° de operación que entrega TUU (sequenceNumber), sirve para buscar el cobro
    codigo_operacion = models.CharField(max_length=40, blank=True)
    error = models.TextField(blank=True)
    respuesta = models.JSONField(default=dict, blank=True)
    creado = models.DateTimeField(auto_now_add=True)
    consultado_en = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['-creado']

    def __str__(self):
        return f"Pago remoto ${self.monto} ({self.get_estado_display()})"
