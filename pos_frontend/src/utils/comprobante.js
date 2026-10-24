/**
 * Comprobante de venta para impresora térmica (80 mm o 58 mm).
 *
 * `htmlComprobante` devuelve un documento HTML completo con sus propios
 * estilos: se usa igual para la vista previa (iframe) y para imprimir, así lo
 * que se ve es exactamente lo que sale en papel.
 *
 * No es una boleta electrónica (SII): se imprime como comprobante interno.
 * Pruebas:  npm test
 */

export const ANCHOS = { '80': '72mm', '58': '48mm' };   // área imprimible de cada rollo

const escapar = (texto) =>
    String(texto ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

const peso = (n) => `$${Math.round(Number(n) || 0).toLocaleString('es-CL')}`;

const fechaHora = (iso) =>
    new Date(iso).toLocaleString('es-CL', {
        day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
    });

const fila = (izquierda, derecha, clase = '') =>
    `<div class="fila ${clase}"><span>${izquierda}</span><span>${derecha}</span></div>`;

export function htmlComprobante({ venta, tienda = {} }, { ancho = '80', copia = false } = {}) {
    const lineas = (venta.detalles || []).map(d => {
        const nombre = escapar(d.nombre_producto || 'Producto');
        const unitario = d.cantidad ? Math.round(d.total_normal / d.cantidad) : d.precio_unitario;
        let html = `<div class="producto">${nombre}</div>`;
        html += fila(`${d.cantidad} x ${peso(unitario)}`, peso(d.total_normal));
        if (d.total_cobrado < d.total_normal) {
            html += fila(`&nbsp;&nbsp;${escapar(d.promocion || 'Descuento')}`, `-${peso(d.total_normal - d.total_cobrado)}`, 'descuento');
        }
        if (d.unidades_devueltas > 0) {
            html += fila(`&nbsp;&nbsp;Devuelto: ${d.unidades_devueltas}`, '', 'descuento');
        }
        return html;
    }).join('');

    const pago = [];
    pago.push(fila('Medio de pago', escapar(venta.metodo_pago_nombre)));
    if (venta.metodo_pago === 'EFECTIVO' && venta.monto_recibido != null) {
        pago.push(fila('Recibido', peso(venta.monto_recibido)));
        pago.push(fila('Vuelto', peso(venta.vuelto)));
    }

    const devoluciones = (venta.devoluciones || []).map(dv =>
        fila(`${dv.es_anulacion ? 'Anulación' : 'Devolución'} ${fechaHora(dv.fecha_hora)}`, `-${peso(dv.total)}`)
    ).join('');

    const cabecera = [
        `<div class="tienda">${escapar(tienda.nombre || 'Tienda')}</div>`,
        tienda.rut && `<div>RUT ${escapar(tienda.rut)}</div>`,
        tienda.direccion && `<div>${escapar(tienda.direccion)}</div>`,
        tienda.telefono && `<div>Tel. ${escapar(tienda.telefono)}</div>`,
        tienda.web && `<div>${escapar(tienda.web)}</div>`,
    ].filter(Boolean).join('');

    return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><title>Comprobante venta ${escapar(venta.id)}</title>
<style>
  @page { size: ${ancho === '58' ? '58mm' : '80mm'} auto; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #fff; color: #000; }
  body { width: ${ANCHOS[ancho] || ANCHOS['80']}; margin: 0 auto; padding: 4mm 0 8mm;
         font: ${ancho === '58' ? '11px' : '12px'}/1.35 "Courier New", ui-monospace, monospace; }
  .centro { text-align: center; }
  .tienda { font-size: 1.35em; font-weight: bold; margin-bottom: 2px; }
  .titulo { font-weight: bold; margin-top: 6px; }
  .aviso { font-size: 0.85em; }
  hr { border: 0; border-top: 1px dashed #000; margin: 6px 0; }
  .fila { display: flex; justify-content: space-between; gap: 8px; }
  .fila span:last-child { white-space: nowrap; }
  .producto { margin-top: 4px; word-break: break-word; }
  .descuento { font-size: 0.92em; }
  .total { font-size: 1.3em; font-weight: bold; margin-top: 2px; }
  .copia { font-weight: bold; letter-spacing: 2px; }
</style></head>
<body>
  <div class="centro">
    ${cabecera}
    <div class="titulo">COMPROBANTE DE VENTA N° ${escapar(venta.id)}</div>
    <div class="aviso">Documento interno · no válido como boleta</div>
    ${copia ? '<div class="copia">— COPIA —</div>' : ''}
  </div>
  <hr>
  ${fila('Fecha', fechaHora(venta.fecha_hora))}
  ${fila('Atendido por', escapar(venta.cajero))}
  <hr>
  ${lineas}
  <hr>
  ${venta.descuento > 0 ? fila('Subtotal', peso(venta.total_normal)) + fila('Descuentos', `-${peso(venta.descuento)}`) : ''}
  ${fila('TOTAL', peso(venta.total), 'total')}
  <hr>
  ${pago.join('')}
  ${devoluciones ? `<hr>${devoluciones}${fila('Total vigente', peso(venta.total - venta.devuelto), 'total')}` : ''}
  <hr>
  <div class="centro">
    ${tienda.mensaje ? `<div>${escapar(tienda.mensaje)}</div>` : ''}
    ${tienda.politica_cambios ? `<div class="aviso">${escapar(tienda.politica_cambios)}</div>` : ''}
  </div>
</body></html>`;
}

/**
 * Imprime un documento HTML en un iframe oculto, sin abrir otra ventana y sin
 * imprimir el resto de la pantalla de la caja.
 */
export function imprimirHTML(html) {
    const iframe = document.createElement('iframe');
    iframe.setAttribute('aria-hidden', 'true');
    Object.assign(iframe.style, { position: 'fixed', right: '0', bottom: '0', width: '0', height: '0', border: '0' });
    document.body.appendChild(iframe);

    const quitar = () => setTimeout(() => iframe.remove(), 1000);
    iframe.onload = () => {
        try {
            iframe.contentWindow.focus();
            iframe.contentWindow.onafterprint = quitar;
            iframe.contentWindow.print();
        } finally {
            setTimeout(quitar, 60000);   // por si el navegador no avisa al terminar
        }
    };
    iframe.srcdoc = html;
}
