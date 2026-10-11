/**
 * Motor de promociones de la caja.
 *
 * Cada promoción tiene uno o más GRUPOS. Un grupo pide `cantidad` unidades que
 * cumplan TODAS sus condiciones; en cada condición basta con coincidir con
 * UNO de sus valores. Ejemplo "3 Motta + 2 Rust-Oleum por $15.000":
 *
 *   grupos: [
 *     { cantidad: 3, condiciones: [{ campo: 'PROVEEDOR', valores: ['Motta'] }] },
 *     { cantidad: 2, condiciones: [{ campo: 'PROVEEDOR', valores: ['Rust-Oleum'] }] },
 *   ]
 *
 * Funcionamiento: el carrito se separa en unidades sueltas. En cada vuelta se
 * calcula cuánto ahorraría el cliente con cada promoción sobre las unidades que
 * aún no tienen descuento, y se aplica la que más ahorra. Se repite hasta que
 * ninguna promoción pueda aplicarse. Una unidad nunca recibe dos promociones.
 *
 * Las claves de los campos deben coincidir con CAMPOS_FILTRO_PROMO en
 * caja/models.py.
 */

// Normaliza texto para comparar: minúsculas, sin tildes y con cualquier
// separador convertido en un espacio ("Rust-Oleum" == "rust oleum").
export const normalizar = (texto) =>
    String(texto ?? '')
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();

const igual = (a, b) => normalizar(a) !== '' && normalizar(a) === normalizar(b);
const contiene = (texto, buscado) => normalizar(buscado) !== '' && normalizar(texto).includes(normalizar(buscado));

// Título de la variante: el buscador lo entrega en `variante`; si no, lo
// deducimos del nombre "Producto - Variante".
const tituloVariante = (item) => {
    if (item.variante) return item.variante;
    const partes = String(item.nombre || '').split(' - ');
    return partes.length > 1 ? partes.slice(1).join(' - ') : '';
};

const COMPARADORES = {
    PROVEEDOR: (item, v) => igual(item.proveedor ?? item.vendor, v),
    TIPO: (item, v) => igual(item.tipo ?? item.product_type, v),
    ETIQUETA: (item, v) => (item.etiquetas || []).some(tag => igual(tag, v)),
    NOMBRE: (item, v) => contiene(item.nombre, v),
    VARIANTE: (item, v) => contiene(tituloVariante(item), v),
    SKU: (item, v) => igual(item.sku, v),
    CODIGO_BARRAS: (item, v) => igual(item.codigo_barras, v),
};

export const cumpleGrupo = (item, grupo) =>
    (grupo.condiciones || []).length > 0 &&
    grupo.condiciones.every(({ campo, valores }) => {
        const comparar = COMPARADORES[campo];
        return comparar && (valores || []).some(v => comparar(item, v));
    });

// Reparte `total` entre las unidades en proporción a su precio normal, sin
// perder pesos por redondeo (la última unidad absorbe la diferencia).
const repartir = (unidades, total) => {
    const normal = unidades.reduce((s, u) => s + u.precio, 0);
    let acumulado = 0;
    return unidades.map((u, i) => {
        if (i === unidades.length - 1) return total - acumulado;
        const parte = normal > 0 ? Math.round((u.precio * total) / normal) : 0;
        acumulado += parte;
        return parte;
    });
};

// Calcula cómo quedaría UNA aplicación de la promoción. Devuelve null si no se
// puede aplicar o si no le conviene al cliente.
const evaluar = (promo, libres, cartItems) => {
    const grupos = promo.grupos || [];
    if (grupos.length === 0) return null;
    const apta = (unidad, grupo) => cumpleGrupo(cartItems[unidad.linea], grupo);

    if (promo.tipo_promocion === 'POR_MAYOR') {
        const grupo = grupos[0];
        const aptas = libres.filter(u => apta(u, grupo));
        if (aptas.length < Number(grupo.cantidad)) return null;
        const precioUnidad = Number(promo.precio_promocional);
        const finales = aptas.map(u => Math.min(u.precio, precioUnidad));
        const ahorro = aptas.reduce((s, u, i) => s + u.precio - finales[i], 0);
        return ahorro > 0 ? { promo, unidades: aptas, finales, ahorro } : null;
    }

    if (promo.tipo_promocion === 'N_X_M') {
        const grupo = grupos[0];
        const llevas = Number(grupo.cantidad);
        const pagas = Number(promo.cantidad_pagada);
        // `libres` viene de mayor a menor precio: tomamos las más caras y se
        // regalan las más baratas del pack (lo habitual en un 3x2).
        const pack = libres.filter(u => apta(u, grupo)).slice(0, llevas);
        if (pack.length < llevas || !(pagas >= 1 && pagas < llevas)) return null;
        const normal = pack.reduce((s, u) => s + u.precio, 0);
        const total = pack.slice(0, pagas).reduce((s, u) => s + u.precio, 0);
        return normal - total > 0
            ? { promo, unidades: pack, finales: repartir(pack, total), ahorro: normal - total }
            : null;
    }

    // VOLUMEN (precio fijo) y PORCENTAJE: packs o combos de varios grupos.
    // Llenamos primero los grupos con menos candidatos, para que un grupo
    // amplio (ej: "cualquier spray") no le quite unidades a uno específico.
    const ordenados = [...grupos].sort(
        (a, b) => libres.filter(u => apta(u, a)).length - libres.filter(u => apta(u, b)).length
    );
    const elegidas = new Set();
    for (const grupo of ordenados) {
        const tomadas = libres.filter(u => !elegidas.has(u) && apta(u, grupo)).slice(0, Number(grupo.cantidad));
        if (tomadas.length < Number(grupo.cantidad)) return null;
        tomadas.forEach(u => elegidas.add(u));
    }
    const pack = libres.filter(u => elegidas.has(u));
    const normal = pack.reduce((s, u) => s + u.precio, 0);
    const total = promo.tipo_promocion === 'PORCENTAJE'
        ? Math.round(normal * (1 - Number(promo.porcentaje_descuento) / 100))
        : Number(promo.precio_promocional);
    if (!(total >= 0) || normal - total <= 0) return null;
    return { promo, unidades: pack, finales: repartir(pack, total), ahorro: normal - total };
};

/**
 * @param {Array} cart  Ítems del carrito ({ precio, cantidad, proveedor, tipo, ... })
 * @param {Array} promociones  Promociones activas del backend
 * @returns {{ lineas: Array, total: number, ahorroTotal: number }}
 *   Cada línea conserva los campos del ítem y agrega precioOriginalLinea,
 *   precioFinalLinea y promoAplicada (texto o null).
 */
export function aplicarPromociones(cart = [], promociones = []) {
    // 1. Carrito -> unidades sueltas, ordenadas de mayor a menor precio
    const unidades = [];
    cart.forEach((item, linea) => {
        for (let i = 0; i < Number(item.cantidad || 0); i++) {
            unidades.push({ linea, precio: Math.round(Number(item.precio) || 0), final: null, promo: null });
        }
    });
    unidades.sort((a, b) => b.precio - a.precio || a.linea - b.linea);

    // 2. Aplicar la promoción que más ahorra hasta que ya no quede ninguna
    for (let vuelta = 0; vuelta < unidades.length; vuelta++) {
        const libres = unidades.filter(u => u.final === null);
        let mejor = null;
        for (const promo of promociones) {
            const opcion = evaluar(promo, libres, cart);
            if (opcion && (!mejor || opcion.ahorro > mejor.ahorro)) mejor = opcion;
        }
        if (!mejor) break;
        mejor.unidades.forEach((u, i) => {
            u.final = mejor.finales[i];
            u.promo = mejor.promo.nombre;
        });
    }

    // 3. Unidades -> líneas del carrito
    const lineas = cart.map((item, linea) => {
        const propias = unidades.filter(u => u.linea === linea);
        const precioOriginalLinea = propias.reduce((s, u) => s + u.precio, 0);
        const precioFinalLinea = propias.reduce((s, u) => s + (u.final ?? u.precio), 0);
        const nombres = [...new Set(propias.filter(u => u.promo).map(u => u.promo))];
        return {
            ...item,
            precioOriginalLinea,
            precioFinalLinea,
            promoAplicada: nombres.length ? nombres.join(' + ') : null,
        };
    });

    const total = lineas.reduce((s, l) => s + l.precioFinalLinea, 0);
    const original = lineas.reduce((s, l) => s + l.precioOriginalLinea, 0);
    return { lineas, total, ahorroTotal: original - total };
}
