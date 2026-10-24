// Pruebas del comprobante de venta. Ejecutar con:  npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { htmlComprobante } from './comprobante.js';

const TIENDA = {
    nombre: 'AloGato GraffStore', rut: '76.123.456-K', direccion: 'Av. Siempre Viva 123',
    telefono: '', web: '', mensaje: '¡Gracias por tu compra!', politica_cambios: 'Cambios con este comprobante.',
};

const ventaPromo = {
    id: 42, fecha_hora: '2026-10-24T17:05:00Z', cajero: 'vendedor1',
    metodo_pago: 'EFECTIVO', metodo_pago_nombre: 'Efectivo', monto_recibido: 20000, vuelto: 5000,
    total: 15000, total_normal: 26400, descuento: 11400, devuelto: 0, devoluciones: [],
    detalles: [
        { nombre_producto: 'Spray Motta Naranja Greda 400 ml', cantidad: 3, precio_unitario: 3600, total_normal: 10800, total_cobrado: 6135, promocion: 'Promo Octubre', unidades_devueltas: 0 },
        { nombre_producto: 'Toro Cromado', cantidad: 2, precio_unitario: 2000, total_normal: 4000, total_cobrado: 2275, promocion: 'Promo Octubre', unidades_devueltas: 0 },
        { nombre_producto: 'Spray Loop 109 Sevilla 400 ml', cantidad: 2, precio_unitario: 5800, total_normal: 11600, total_cobrado: 6590, promocion: 'Promo Octubre', unidades_devueltas: 0 },
    ],
};

// Texto visible del HTML (sin etiquetas), para comprobar contenidos
const texto = (html) => html.replace(/<style[\s\S]*?<\/style>/, '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');

test('incluye tienda, número, total, descuentos y vuelto', () => {
    const t = texto(htmlComprobante({ venta: ventaPromo, tienda: TIENDA }));
    for (const esperado of ['AloGato GraffStore', 'RUT 76.123.456-K', 'COMPROBANTE DE VENTA N° 42',
        'no válido como boleta', 'TOTAL $15.000', 'Descuentos -$11.400', 'Subtotal $26.400',
        'Recibido $20.000', 'Vuelto $5.000', 'Atendido por vendedor1', '3 x $3.600 $10.800',
        'Promo Octubre -$4.665', '¡Gracias por tu compra!']) {
        assert.ok(t.includes(esperado), `falta: ${esperado}\n${t}`);
    }
});

test('omite datos vacíos de la tienda', () => {
    const t = texto(htmlComprobante({ venta: ventaPromo, tienda: TIENDA }));
    assert.ok(!t.includes('Tel.'));
});

test('venta con tarjeta no muestra recibido ni vuelto', () => {
    const venta = { ...ventaPromo, metodo_pago: 'TARJETA_TUU', metodo_pago_nombre: 'Tarjeta TUU', monto_recibido: null, vuelto: 0 };
    const t = texto(htmlComprobante({ venta, tienda: TIENDA }));
    assert.ok(t.includes('Medio de pago Tarjeta TUU'));
    assert.ok(!t.includes('Recibido'));
});

test('venta sin descuento no muestra subtotal ni descuentos', () => {
    const venta = {
        ...ventaPromo, total: 7200, total_normal: 7200, descuento: 0,
        detalles: [{ nombre_producto: 'Spray', cantidad: 2, precio_unitario: 3600, total_normal: 7200, total_cobrado: 7200, promocion: '', unidades_devueltas: 0 }],
    };
    const t = texto(htmlComprobante({ venta, tienda: TIENDA }));
    assert.ok(!t.includes('Subtotal') && !t.includes('Descuentos'));
});

test('reimpresión con devolución muestra lo devuelto y el total vigente', () => {
    const venta = {
        ...ventaPromo, devuelto: 6135,
        devoluciones: [{ es_anulacion: false, fecha_hora: '2026-10-25T13:00:00Z', total: 6135 }],
        detalles: ventaPromo.detalles.map((d, i) => (i === 0 ? { ...d, unidades_devueltas: 3 } : d)),
    };
    const t = texto(htmlComprobante({ venta, tienda: TIENDA }, { copia: true }));
    assert.ok(t.includes('— COPIA —'));
    assert.ok(t.includes('Devuelto: 3'));
    assert.ok(t.includes('Total vigente $8.865'));
});

test('escapa HTML en nombres de productos (no se puede inyectar código)', () => {
    const venta = { ...ventaPromo, detalles: [{ ...ventaPromo.detalles[0], nombre_producto: '<img src=x onerror=alert(1)>' }] };
    const html = htmlComprobante({ venta, tienda: TIENDA });
    assert.ok(!html.includes('<img'));
    assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
});

test('ancho de 58 mm', () => {
    const html = htmlComprobante({ venta: ventaPromo, tienda: TIENDA }, { ancho: '58' });
    assert.ok(html.includes('size: 58mm auto') && html.includes('width: 48mm'));
});
