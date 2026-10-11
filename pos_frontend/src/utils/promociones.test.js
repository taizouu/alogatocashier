// Pruebas del motor de promociones. Ejecutar con:  npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aplicarPromociones, cumpleGrupo, normalizar } from './promociones.js';

// --- Productos de ejemplo ---
const motta = (color, precio = 4000) => ({
    id_shopify: `motta-${color}`, nombre: `Motta 400ml - ${color}`, variante: color,
    proveedor: 'Motta', tipo: 'Spray', etiquetas: ['lata', 'spray'], precio,
});
const rust = (color, precio = 5000) => ({
    id_shopify: `rust-${color}`, nombre: `Rust-Oleum Painter's Touch - ${color}`, variante: color,
    proveedor: 'Rust-Oleum', tipo: 'Spray', etiquetas: ['lata'], precio,
});
const toro = (color, precio = 3000) => ({
    id_shopify: `toro-${color}`, nombre: `Toro 400ml - ${color}`, variante: color,
    proveedor: 'Toro', tipo: 'Spray', etiquetas: [], precio,
});
const enCarrito = (producto, cantidad) => ({ ...producto, cantidad });
const filtro = (campo, ...valores) => ({ campo, valores });

// --- Las tres promociones del cliente ---
const PROMO_3_MOTTA = {
    nombre: '3 Motta x $10.000', tipo_promocion: 'VOLUMEN', precio_promocional: 10000,
    grupos: [{ cantidad: 3, condiciones: [filtro('PROVEEDOR', 'Motta')] }],
};
const PROMO_COMBO = {
    nombre: '3 Motta + 2 Rust x $15.000', tipo_promocion: 'VOLUMEN', precio_promocional: 15000,
    grupos: [
        { cantidad: 3, condiciones: [filtro('PROVEEDOR', 'Motta')] },
        { cantidad: 2, condiciones: [filtro('PROVEEDOR', 'Rust-Oleum')] },
    ],
};
const PROMO_6_TORO_NEGRO = {
    nombre: '6 Toro negro x $15.000', tipo_promocion: 'VOLUMEN', precio_promocional: 15000,
    grupos: [{ cantidad: 6, condiciones: [filtro('PROVEEDOR', 'Toro'), filtro('VARIANTE', 'Negro')] }],
};

test('3 latas Motta (colores distintos) por $10.000', () => {
    const r = aplicarPromociones(
        [enCarrito(motta('Azul'), 1), enCarrito(motta('Rojo'), 1), enCarrito(motta('Verde'), 1)],
        [PROMO_3_MOTTA]
    );
    assert.equal(r.total, 10000);
    assert.equal(r.ahorroTotal, 2000);
    r.lineas.forEach(l => assert.equal(l.promoAplicada, '3 Motta x $10.000'));
});

test('4 Motta: el pack cubre 3 y la cuarta se cobra normal', () => {
    const r = aplicarPromociones([enCarrito(motta('Azul'), 4)], [PROMO_3_MOTTA]);
    assert.equal(r.total, 14000);
});

test('combo 3 Motta + 2 Rust-Oleum por $15.000', () => {
    const r = aplicarPromociones(
        [enCarrito(motta('Azul'), 3), enCarrito(rust('Negro'), 2)],
        [PROMO_COMBO]
    );
    assert.equal(r.total, 15000); // normal: 12.000 + 10.000 = 22.000
});

test('combo incompleto (solo 1 Rust) no se aplica', () => {
    const r = aplicarPromociones(
        [enCarrito(motta('Azul'), 3), enCarrito(rust('Negro'), 1)],
        [PROMO_COMBO]
    );
    assert.equal(r.total, 17000);
    assert.equal(r.ahorroTotal, 0);
});

test('6 Toro negro por $15.000 (filtros proveedor Y variante)', () => {
    const r = aplicarPromociones([enCarrito(toro('Negro'), 6)], [PROMO_6_TORO_NEGRO]);
    assert.equal(r.total, 15000); // normal: 18.000
});

test('Toro de otro color no cuenta para la promo de Toro negro', () => {
    const r = aplicarPromociones(
        [enCarrito(toro('Negro'), 5), enCarrito(toro('Blanco'), 1)],
        [PROMO_6_TORO_NEGRO]
    );
    assert.equal(r.total, 18000);
});

test('con ambas promos activas elige la combinación que más ahorra', () => {
    // 6 Motta + 2 Rust: combo (ahorra 7.000) + 3 Motta (ahorra 2.000) = 9.000
    // es mejor que 2 x "3 Motta" (ahorra 4.000)
    const r = aplicarPromociones(
        [enCarrito(motta('Azul'), 6), enCarrito(rust('Negro'), 2)],
        [PROMO_3_MOTTA, PROMO_COMBO]
    );
    assert.equal(r.ahorroTotal, 9000);
    assert.equal(r.total, 24000 + 10000 - 9000);
});

test('el pack nunca cobra más que el precio normal', () => {
    const baratas = [enCarrito(motta('Azul', 3000), 3)]; // normal 9.000 < pack 10.000
    const r = aplicarPromociones(baratas, [PROMO_3_MOTTA]);
    assert.equal(r.total, 9000);
    assert.equal(r.lineas[0].promoAplicada, null);
});

test('3x2: se regala la más barata del pack', () => {
    const promo = {
        nombre: '3x2 sprays', tipo_promocion: 'N_X_M', cantidad_pagada: 2,
        grupos: [{ cantidad: 3, condiciones: [filtro('TIPO', 'spray')] }],
    };
    const r = aplicarPromociones(
        [enCarrito(rust('Negro'), 1), enCarrito(motta('Azul'), 1), enCarrito(toro('Rojo'), 1)],
        [promo]
    );
    assert.equal(r.total, 5000 + 4000); // la Toro de $3.000 sale gratis
});

test('por mayor: desde 10 unidades cada una a $3.500', () => {
    const promo = {
        nombre: 'Mayorista Motta', tipo_promocion: 'POR_MAYOR', precio_promocional: 3500,
        grupos: [{ cantidad: 10, condiciones: [filtro('PROVEEDOR', 'Motta')] }],
    };
    assert.equal(aplicarPromociones([enCarrito(motta('Azul'), 9)], [promo]).total, 36000);
    assert.equal(aplicarPromociones([enCarrito(motta('Azul'), 12)], [promo]).total, 42000);
});

test('porcentaje: 20% al llevar 2 Rust-Oleum', () => {
    const promo = {
        nombre: '2 Rust 20%', tipo_promocion: 'PORCENTAJE', porcentaje_descuento: 20,
        grupos: [{ cantidad: 2, condiciones: [filtro('PROVEEDOR', 'rust oleum')] }],
    };
    assert.equal(aplicarPromociones([enCarrito(rust('Negro'), 2)], [promo]).total, 8000);
});

test('varios valores en un filtro funcionan como "o"', () => {
    const promo = {
        nombre: '3 Motta o Toro', tipo_promocion: 'VOLUMEN', precio_promocional: 9000,
        grupos: [{ cantidad: 3, condiciones: [filtro('PROVEEDOR', 'Motta', 'Toro')] }],
    };
    const r = aplicarPromociones(
        [enCarrito(motta('Azul'), 2), enCarrito(toro('Rojo'), 1)],
        [promo]
    );
    assert.equal(r.total, 9000); // normal 11.000
});

test('etiqueta, nombre y comparación tolerante a mayúsculas, tildes y guiones', () => {
    assert.equal(normalizar('  Rust-Oleum '), 'rust oleum');
    assert.equal(normalizar('Plástico'), 'plastico');
    assert.ok(cumpleGrupo(motta('Azul'), { condiciones: [filtro('ETIQUETA', 'LATA')] }));
    assert.ok(cumpleGrupo(motta('Azul'), { condiciones: [filtro('NOMBRE', '400ML')] }));
    assert.ok(!cumpleGrupo(motta('Azul'), { condiciones: [] }));
});

test('los totales siempre son enteros y cuadran con la suma de las líneas', () => {
    const promo = { ...PROMO_3_MOTTA, precio_promocional: 10001 };
    const r = aplicarPromociones(
        [enCarrito(motta('Azul', 3333), 1), enCarrito(motta('Rojo', 3700), 1), enCarrito(motta('Verde', 4100), 1)],
        [promo]
    );
    assert.equal(r.total, 10001);
    assert.equal(r.lineas.reduce((s, l) => s + l.precioFinalLinea, 0), 10001);
    r.lineas.forEach(l => assert.ok(Number.isInteger(l.precioFinalLinea)));
});

test('sin promociones el carrito queda igual', () => {
    const r = aplicarPromociones([enCarrito(motta('Azul'), 2)], []);
    assert.equal(r.total, 8000);
    assert.equal(r.lineas[0].precioFinalLinea, 8000);
});

test('caso real "Promo Octubre": 3 Motta + 2 Toro Cromado + 2 Loop por $15.000', () => {
    // Datos tal como los entrega Shopify (tienda Alogato Graffiti)
    const mottaReal = {
        id_shopify: 'motta-naranja', nombre: 'Spray Motta Naranja Greda 400 ml – Pintura para graffiti',
        sku: '07_NaranjaGreda_400', precio: 3600, proveedor: 'Motta', tipo: 'Aerosoles',
        etiquetas: ['400 ML', 'Estandar', 'Motta', 'naranjo', 'pintura en aerosol', 'spray graffiti'],
    };
    const toroReal = {
        id_shopify: 'toro-cromado', nombre: 'Toro Cromado', sku: 'TN0070', precio: 2000,
        proveedor: 'Toro', tipo: 'Aerosoles', etiquetas: ['400 ML', 'Cromado'],
    };
    const loopReal = {
        id_shopify: 'loop-109', nombre: 'Spray Loop 109 Sevilla 400 ml – Pintura para graffiti',
        sku: 'LOOP-109', precio: 5800, proveedor: 'Loop Colors', tipo: 'Aerosoles',
        etiquetas: ['400 ML', 'Loop Colors', 'spray graffiti'],
    };
    const promoOctubre = {
        nombre: 'Promo Octubre', tipo_promocion: 'VOLUMEN', precio_promocional: 15000,
        grupos: [
            { cantidad: 3, condiciones: [filtro('PROVEEDOR', 'Motta'), filtro('TIPO', 'Aerosoles')] },
            { cantidad: 2, condiciones: [filtro('PROVEEDOR', 'Toro'), filtro('TIPO', 'Aerosoles'), filtro('ETIQUETA', 'Cromado')] },
            { cantidad: 2, condiciones: [filtro('PROVEEDOR', 'Loop Colors'), filtro('TIPO', 'Aerosoles')] },
        ],
    };
    const r = aplicarPromociones(
        [enCarrito(mottaReal, 3), enCarrito(toroReal, 2), enCarrito(loopReal, 2)],
        [PROMO_3_MOTTA, promoOctubre]
    );
    // Normal $26.400. La Promo Octubre ($15.000) ahorra más que "3 Motta" ($800)
    assert.equal(r.total, 15000);
    r.lineas.forEach(l => assert.equal(l.promoAplicada, 'Promo Octubre'));
});
