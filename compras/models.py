from django.db import models

class Proveedor(models.Model):
    rut = models.CharField(max_length=12, unique=True, help_text="RUT del proveedor (ej: 76.123.456-K)")
    razon_social = models.CharField(max_length=255)
    telefono = models.CharField(max_length=20, blank=True, null=True)
    email = models.EmailField(blank=True, null=True)
    activo = models.BooleanField(default=True)

    def __str__(self):
        return f"{self.razon_social} ({self.rut})"

class FacturaCompra(models.Model):
    folio = models.CharField(max_length=50, help_text="Número de folio del DTE")
    proveedor = models.ForeignKey(Proveedor, on_delete=models.PROTECT, related_name='facturas')
    fecha_emision = models.DateField(help_text="Fecha que indica la factura")
    fecha_recepcion = models.DateTimeField(auto_now_add=True, help_text="Cuándo se ingresó al sistema")
    
    # Este campo es la clave para la arquitectura que conversamos
    sincronizado_shopify = models.BooleanField(
        default=False, 
        help_text="True si el inventario ya se actualizó con éxito en Shopify"
    )

    def __str__(self):
        return f"Factura {self.folio} - {self.proveedor.razon_social}"

class DetalleFactura(models.Model):
    factura = models.ForeignKey(FacturaCompra, on_delete=models.CASCADE, related_name='detalles')
    
    # Guardamos tanto el SKU local como el ID de Shopify para facilitar la llamada a la API
    sku = models.CharField(max_length=100, help_text="Código de barras o SKU del producto")
    shopify_variant_id = models.CharField(max_length=50, blank=True, null=True, help_text="ID de la variante en Shopify")
    
    cantidad = models.PositiveIntegerField()
    costo_unitario = models.DecimalField(max_digits=10, decimal_places=2, help_text="Costo neto de compra")

    def __str__(self):
        return f"{self.cantidad}x {self.sku} (Factura {self.factura.folio})"