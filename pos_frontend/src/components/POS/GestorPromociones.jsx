import React, { useState, useEffect, useMemo } from 'react';
import { posService } from '../../services/api';
import { Tag, Save, Trash2, Plus, X, Pencil, RefreshCw, Layers } from 'lucide-react';

// --- Catálogo de tipos de promoción ---
const TIPOS = {
    VOLUMEN: { nombre: 'Precio fijo por pack o combo', ejemplo: '3 Motta por $10.000 · 3 Motta + 2 Rust por $15.000', combo: true },
    PORCENTAJE: { nombre: 'Descuento % por pack o combo', ejemplo: '20% al llevar 2 Rust-Oleum', combo: true },
    N_X_M: { nombre: 'Lleva N, paga M', ejemplo: '3x2 en sprays (se regala el más barato)', combo: false },
    POR_MAYOR: { nombre: 'Precio por mayor', ejemplo: 'Desde 12 Motta, cada una a $3.500', combo: false },
};

// Campos con lista de valores del catálogo de Shopify
const SUGERENCIAS_POR_CAMPO = { PROVEEDOR: 'proveedores', TIPO: 'tipos', ETIQUETA: 'etiquetas' };
const PLACEHOLDER_POR_CAMPO = {
    PROVEEDOR: 'Ej: Motta', TIPO: 'Ej: Spray', ETIQUETA: 'Ej: lata',
    NOMBRE: 'Ej: 400ml', VARIANTE: 'Ej: Negro', SKU: 'Ej: MTA-400-NEG', CODIGO_BARRAS: 'Ej: 7801234567890',
};
const CAMPOS_RESPALDO = [
    { clave: 'PROVEEDOR', nombre: 'Proveedor / Marca' },
    { clave: 'TIPO', nombre: 'Tipo de producto' },
    { clave: 'ETIQUETA', nombre: 'Etiqueta' },
    { clave: 'NOMBRE', nombre: 'Nombre contiene' },
    { clave: 'VARIANTE', nombre: 'Variante contiene (color, tamaño...)' },
    { clave: 'SKU', nombre: 'SKU' },
    { clave: 'CODIGO_BARRAS', nombre: 'Código de barras' },
];

const grupoVacio = () => ({ cantidad: 1, condiciones: [{ campo: 'PROVEEDOR', valores: [] }] });

const formularioVacio = () => ({
    nombre: '',
    tipo_promocion: 'VOLUMEN',
    grupos: [grupoVacio()],
    precio_promocional: '',
    cantidad_pagada: '',
    porcentaje_descuento: '',
    fecha_inicio: '',
    fecha_fin: '',
    activa: true,
});

// <input type="datetime-local"> trabaja en hora local sin zona horaria
const isoALocal = (iso) => {
    if (!iso) return '';
    const d = new Date(iso);
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
const localAIso = (local) => (local ? new Date(local).toISOString() : null);
const formatoPeso = (n) => `$${Number(n || 0).toLocaleString('es-CL')}`;

// Descripción legible de una promoción, para la tabla y la vista previa
function describirPromocion(promo, campos = CAMPOS_RESPALDO) {
    const nombreCampo = Object.fromEntries(campos.map(c => [c.clave, c.nombre]));
    const grupos = (promo.grupos || []).map(g => {
        const filtros = (g.condiciones || [])
            .filter(c => c.valores?.length)
            .map(c => `${nombreCampo[c.campo] || c.campo}: ${c.valores.join(' o ')}`)
            .join(' y ');
        return `${g.cantidad || '?'} × (${filtros || 'sin filtros'})`;
    });
    const productos = grupos.join(' + ');
    switch (promo.tipo_promocion) {
        case 'VOLUMEN': return `${productos} → ${formatoPeso(promo.precio_promocional)}`;
        case 'PORCENTAJE': return `${productos} → ${promo.porcentaje_descuento || '?'}% de descuento`;
        case 'N_X_M': return `Lleva ${productos}, paga ${promo.cantidad_pagada || '?'}`;
        case 'POR_MAYOR': return `Desde ${productos} → ${formatoPeso(promo.precio_promocional)} c/u`;
        default: return productos;
    }
}

// Campo para escribir varios valores como "chips". Enter, coma o salir del campo agrega el valor.
function ValoresInput({ valores, onChange, sugerencias = [], placeholder, idLista }) {
    const [texto, setTexto] = useState('');

    const agregar = () => {
        const valor = texto.trim().replace(/,$/, '').trim();
        if (valor && !valores.some(v => v.toLowerCase() === valor.toLowerCase())) {
            onChange([...valores, valor]);
        }
        setTexto('');
    };

    return (
        <div className="flex flex-wrap items-center gap-1.5 p-1.5 min-h-[46px] border border-slate-300 rounded-lg bg-white focus-within:ring-2 focus-within:ring-emerald-500">
            {valores.map(v => (
                <span key={v} className="inline-flex items-center gap-1 bg-emerald-100 text-emerald-800 text-sm font-medium pl-2.5 pr-1 py-1 rounded-md">
                    {v}
                    <button type="button" onClick={() => onChange(valores.filter(x => x !== v))}
                        className="p-0.5 rounded hover:bg-emerald-200 cursor-pointer" aria-label={`Quitar ${v}`}>
                        <X className="w-3.5 h-3.5" />
                    </button>
                </span>
            ))}
            <input
                type="text"
                list={sugerencias.length ? idLista : undefined}
                value={texto}
                onChange={(e) => {
                    const nuevo = e.target.value;
                    // Elegir una opción del desplegable la agrega de inmediato
                    if (sugerencias.includes(nuevo) && !valores.includes(nuevo)) {
                        onChange([...valores, nuevo]);
                        setTexto('');
                    } else {
                        setTexto(nuevo);
                    }
                }}
                onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); agregar(); }
                    if (e.key === 'Backspace' && !texto && valores.length) onChange(valores.slice(0, -1));
                }}
                onBlur={agregar}
                placeholder={valores.length ? 'Agregar otro...' : placeholder}
                className="flex-1 min-w-[140px] p-1.5 outline-none text-sm bg-transparent"
            />
            {sugerencias.length > 0 && (
                <datalist id={idLista}>
                    {sugerencias.map(s => <option key={s} value={s} />)}
                </datalist>
            )}
        </div>
    );
}

export default function GestorPromociones() {
    const [promociones, setPromociones] = useState([]);
    const [opciones, setOpciones] = useState({ campos: CAMPOS_RESPALDO, proveedores: [], tipos: [], etiquetas: [] });
    const [avisoCatalogo, setAvisoCatalogo] = useState('');
    const [formulario, setFormulario] = useState(formularioVacio());
    const [editandoId, setEditandoId] = useState(null);
    const [guardando, setGuardando] = useState(false);
    const [errores, setErrores] = useState([]);

    useEffect(() => {
        cargarPromociones();
        cargarOpciones();
    }, []);

    const cargarPromociones = async () => {
        try {
            setPromociones(await posService.obtenerTodasPromociones());
        } catch (error) {
            console.error('Error al cargar promociones', error);
        }
    };

    const cargarOpciones = async (refrescar = false) => {
        try {
            const data = await posService.obtenerOpcionesPromocion(refrescar);
            setOpciones({ ...data, campos: data.campos?.length ? data.campos : CAMPOS_RESPALDO });
            setAvisoCatalogo('');
        } catch {
            setAvisoCatalogo('No se pudo leer el catálogo de Shopify; puedes escribir los valores a mano.');
        }
    };

    const tipo = TIPOS[formulario.tipo_promocion];
    const actualizar = (cambios) => setFormulario(prev => ({ ...prev, ...cambios }));

    // --- Edición de grupos y filtros ---
    const actualizarGrupo = (gi, cambios) =>
        actualizar({ grupos: formulario.grupos.map((g, i) => (i === gi ? { ...g, ...cambios } : g)) });

    const actualizarCondicion = (gi, ci, cambios) =>
        actualizarGrupo(gi, {
            condiciones: formulario.grupos[gi].condiciones.map((c, i) => (i === ci ? { ...c, ...cambios } : c)),
        });

    const agregarCondicion = (gi) => {
        // Proponemos un campo que el grupo aún no use
        const usados = formulario.grupos[gi].condiciones.map(c => c.campo);
        const libre = opciones.campos.find(c => !usados.includes(c.clave))?.clave || 'NOMBRE';
        actualizarGrupo(gi, { condiciones: [...formulario.grupos[gi].condiciones, { campo: libre, valores: [] }] });
    };

    const quitarCondicion = (gi, ci) =>
        actualizarGrupo(gi, { condiciones: formulario.grupos[gi].condiciones.filter((_, i) => i !== ci) });

    const cambiarTipo = (nuevoTipo) => {
        // NxM y Por mayor usan un solo grupo
        const grupos = TIPOS[nuevoTipo].combo ? formulario.grupos : formulario.grupos.slice(0, 1);
        actualizar({ tipo_promocion: nuevoTipo, grupos });
    };

    // --- Guardar ---
    const handleSubmit = async (e) => {
        e.preventDefault();
        setErrores([]);
        setGuardando(true);

        const payload = {
            nombre: formulario.nombre.trim(),
            tipo_promocion: formulario.tipo_promocion,
            grupos: formulario.grupos.map(g => ({
                cantidad: Number(g.cantidad),
                condiciones: g.condiciones.filter(c => c.valores.length),
            })),
            precio_promocional: formulario.precio_promocional === '' ? null : Number(formulario.precio_promocional),
            cantidad_pagada: formulario.cantidad_pagada === '' ? null : Number(formulario.cantidad_pagada),
            porcentaje_descuento: formulario.porcentaje_descuento === '' ? null : Number(formulario.porcentaje_descuento),
            fecha_fin: localAIso(formulario.fecha_fin),
            activa: formulario.activa,
        };
        if (formulario.fecha_inicio) payload.fecha_inicio = localAIso(formulario.fecha_inicio);

        try {
            if (editandoId) {
                await posService.actualizarPromocion(editandoId, payload);
            } else {
                await posService.crearPromocion(payload);
            }
            cancelarEdicion();
            cargarPromociones();
        } catch (error) {
            const data = error.response?.data;
            if (data && typeof data === 'object') {
                setErrores(Object.values(data).flat().map(String));
            } else {
                setErrores(['No se pudo guardar la promoción.']);
            }
        } finally {
            setGuardando(false);
        }
    };

    const editar = (promo) => {
        setEditandoId(promo.id);
        setErrores([]);
        setFormulario({
            nombre: promo.nombre,
            tipo_promocion: promo.tipo_promocion,
            grupos: (promo.grupos?.length ? promo.grupos : [grupoVacio()]).map(g => ({
                cantidad: g.cantidad,
                condiciones: (g.condiciones || []).map(c => ({ campo: c.campo, valores: [...(c.valores || [])] })),
            })),
            precio_promocional: promo.precio_promocional ?? '',
            cantidad_pagada: promo.cantidad_pagada ?? '',
            porcentaje_descuento: promo.porcentaje_descuento ?? '',
            fecha_inicio: isoALocal(promo.fecha_inicio),
            fecha_fin: isoALocal(promo.fecha_fin),
            activa: promo.activa,
        });
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const cancelarEdicion = () => {
        setEditandoId(null);
        setErrores([]);
        setFormulario(formularioVacio());
    };

    const alternarActiva = async (promo) => {
        try {
            await posService.actualizarPromocion(promo.id, { activa: !promo.activa });
            cargarPromociones();
        } catch {
            alert('No se pudo cambiar el estado de la promoción.');
        }
    };

    const handleEliminar = async (promo) => {
        if (!window.confirm(`¿Eliminar la promoción "${promo.nombre}"? Esta acción no se puede deshacer.`)) return;
        try {
            await posService.eliminarPromocion(promo.id);
            if (editandoId === promo.id) cancelarEdicion();
            cargarPromociones();
        } catch {
            alert('Hubo un error al eliminar la promoción.');
        }
    };

    const vistaPrevia = useMemo(() => describirPromocion(formulario, opciones.campos), [formulario, opciones.campos]);

    const estadoVigencia = (promo) => {
        const ahora = new Date();
        if (!promo.activa) return { texto: 'Pausada', clase: 'bg-gray-100 text-gray-600' };
        if (promo.fecha_inicio && new Date(promo.fecha_inicio) > ahora) return { texto: 'Programada', clase: 'bg-blue-100 text-blue-700' };
        if (promo.fecha_fin && new Date(promo.fecha_fin) < ahora) return { texto: 'Vencida', clase: 'bg-red-100 text-red-700' };
        return { texto: 'Activa', clase: 'bg-green-100 text-green-700' };
    };

    const inputClase = 'w-full p-3 border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-emerald-500 bg-white';

    return (
        <div className="p-6 bg-gray-50 min-h-screen">
            <div className="max-w-6xl mx-auto space-y-6">

                {/* ============ FORMULARIO ============ */}
                <form onSubmit={handleSubmit} className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 space-y-6">
                    <div className="flex items-center justify-between gap-4">
                        <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                            <Tag className="w-6 h-6 text-emerald-600" />
                            {editandoId ? 'Editar promoción' : 'Nueva promoción'}
                        </h2>
                        <button type="button" onClick={() => cargarOpciones(true)}
                            className="text-sm text-slate-500 hover:text-emerald-700 flex items-center gap-1 cursor-pointer"
                            title="Volver a leer proveedores, tipos y etiquetas desde Shopify">
                            <RefreshCw className="w-4 h-4" /> Actualizar catálogo
                        </button>
                    </div>

                    {avisoCatalogo && (
                        <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-sm">{avisoCatalogo}</div>
                    )}

                    {/* Nombre */}
                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-2">Nombre de la oferta</label>
                        <input required type="text" value={formulario.nombre} maxLength={100}
                            onChange={e => actualizar({ nombre: e.target.value })}
                            placeholder="Ej: 3 Motta + 2 Rust-Oleum por $15.000" className={inputClase} />
                    </div>

                    {/* Tipo */}
                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-2">Tipo de promoción</label>
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                            {Object.entries(TIPOS).map(([clave, t]) => (
                                <button key={clave} type="button" onClick={() => cambiarTipo(clave)}
                                    className={`text-left p-3 rounded-lg border-2 transition-colors cursor-pointer ${
                                        formulario.tipo_promocion === clave
                                            ? 'border-emerald-500 bg-emerald-50'
                                            : 'border-slate-200 hover:border-slate-300'
                                    }`}>
                                    <span className="block font-semibold text-slate-800 text-sm">{t.nombre}</span>
                                    <span className="block text-xs text-slate-500 mt-1">{t.ejemplo}</span>
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Grupos de productos */}
                    <div className="space-y-3">
                        <div className="flex items-center justify-between">
                            <label className="text-sm font-medium text-slate-700 flex items-center gap-2">
                                <Layers className="w-4 h-4" /> Productos que activan la promoción
                            </label>
                            <span className="text-xs text-slate-500">
                                Un producto debe cumplir <strong>todos</strong> los filtros de su grupo
                            </span>
                        </div>

                        {formulario.grupos.map((grupo, gi) => (
                            <div key={gi} className="border border-slate-200 rounded-lg p-4 bg-slate-50 space-y-3">
                                <div className="flex items-center gap-3">
                                    {formulario.grupos.length > 1 && (
                                        <span className="text-xs font-bold text-slate-500 uppercase">Grupo {gi + 1}</span>
                                    )}
                                    <label className="text-sm text-slate-700">Cantidad</label>
                                    <input type="number" min="1" max="999" required value={grupo.cantidad}
                                        onChange={e => actualizarGrupo(gi, { cantidad: e.target.value })}
                                        className="w-24 p-2 border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-emerald-500 text-center font-bold bg-white" />
                                    <span className="text-sm text-slate-500">unidades que cumplan:</span>
                                    {formulario.grupos.length > 1 && (
                                        <button type="button"
                                            onClick={() => actualizar({ grupos: formulario.grupos.filter((_, i) => i !== gi) })}
                                            className="ml-auto text-sm text-red-600 hover:bg-red-50 px-2 py-1 rounded cursor-pointer">
                                            Quitar grupo
                                        </button>
                                    )}
                                </div>

                                {grupo.condiciones.map((cond, ci) => {
                                    const listaClave = SUGERENCIAS_POR_CAMPO[cond.campo];
                                    return (
                                        <div key={ci} className="flex flex-col md:flex-row gap-2 md:items-start">
                                            {ci > 0 && <span className="md:w-6 pt-3 text-xs font-bold text-slate-400">Y</span>}
                                            <select value={cond.campo}
                                                onChange={e => actualizarCondicion(gi, ci, { campo: e.target.value, valores: [] })}
                                                className={`md:w-64 p-3 border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-emerald-500 bg-white text-sm ${ci === 0 ? 'md:ml-8' : ''}`}>
                                                {opciones.campos.map(c => <option key={c.clave} value={c.clave}>{c.nombre}</option>)}
                                            </select>
                                            <div className="flex-1">
                                                <ValoresInput
                                                    valores={cond.valores}
                                                    onChange={valores => actualizarCondicion(gi, ci, { valores })}
                                                    sugerencias={listaClave ? opciones[listaClave] || [] : []}
                                                    placeholder={PLACEHOLDER_POR_CAMPO[cond.campo]}
                                                    idLista={`sug-${gi}-${ci}`}
                                                />
                                                {cond.valores.length > 1 && (
                                                    <p className="text-xs text-slate-500 mt-1">Basta con coincidir con uno de estos valores.</p>
                                                )}
                                            </div>
                                            <button type="button" onClick={() => quitarCondicion(gi, ci)}
                                                disabled={grupo.condiciones.length === 1}
                                                className="p-3 text-slate-400 hover:text-red-600 disabled:opacity-30 disabled:hover:text-slate-400 cursor-pointer"
                                                title="Quitar filtro">
                                                <X className="w-5 h-5" />
                                            </button>
                                        </div>
                                    );
                                })}

                                <button type="button" onClick={() => agregarCondicion(gi)}
                                    className="md:ml-8 text-sm text-emerald-700 hover:bg-emerald-50 px-2 py-1 rounded flex items-center gap-1 cursor-pointer">
                                    <Plus className="w-4 h-4" /> Agregar filtro
                                </button>
                            </div>
                        ))}

                        {tipo.combo && formulario.grupos.length < 10 && (
                            <button type="button" onClick={() => actualizar({ grupos: [...formulario.grupos, grupoVacio()] })}
                                className="w-full p-3 border-2 border-dashed border-slate-300 rounded-lg text-slate-600 hover:border-emerald-400 hover:text-emerald-700 flex items-center justify-center gap-2 cursor-pointer">
                                <Plus className="w-4 h-4" /> Agregar otro grupo (combo: ej. + 2 Rust-Oleum)
                            </button>
                        )}
                    </div>

                    {/* Valor de la promoción + vigencia */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        <div>
                            {formulario.tipo_promocion === 'VOLUMEN' && (<>
                                <label className="block text-sm font-medium text-slate-700 mb-2">Precio total del pack ($)</label>
                                <input required type="number" min="1" value={formulario.precio_promocional}
                                    onChange={e => actualizar({ precio_promocional: e.target.value })}
                                    placeholder="Ej: 15000" className={`${inputClase} border-emerald-300 bg-emerald-50`} />
                            </>)}
                            {formulario.tipo_promocion === 'POR_MAYOR' && (<>
                                <label className="block text-sm font-medium text-slate-700 mb-2">Precio por unidad ($)</label>
                                <input required type="number" min="1" value={formulario.precio_promocional}
                                    onChange={e => actualizar({ precio_promocional: e.target.value })}
                                    placeholder="Ej: 3500" className={`${inputClase} border-emerald-300 bg-emerald-50`} />
                            </>)}
                            {formulario.tipo_promocion === 'PORCENTAJE' && (<>
                                <label className="block text-sm font-medium text-slate-700 mb-2">Descuento (%)</label>
                                <input required type="number" min="1" max="100" value={formulario.porcentaje_descuento}
                                    onChange={e => actualizar({ porcentaje_descuento: e.target.value })}
                                    placeholder="Ej: 20" className={`${inputClase} border-emerald-300 bg-emerald-50`} />
                            </>)}
                            {formulario.tipo_promocion === 'N_X_M' && (<>
                                <label className="block text-sm font-medium text-slate-700 mb-2">Unidades que se pagan</label>
                                <input required type="number" min="1" value={formulario.cantidad_pagada}
                                    onChange={e => actualizar({ cantidad_pagada: e.target.value })}
                                    placeholder="Para un 3x2, escribe 2" className={`${inputClase} border-emerald-300 bg-emerald-50`} />
                            </>)}
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-2">Desde (opcional)</label>
                            <input type="datetime-local" value={formulario.fecha_inicio}
                                onChange={e => actualizar({ fecha_inicio: e.target.value })} className={inputClase} />
                            <p className="text-xs text-slate-500 mt-1">Vacío = desde ahora</p>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-2">Hasta (opcional)</label>
                            <input type="datetime-local" value={formulario.fecha_fin}
                                onChange={e => actualizar({ fecha_fin: e.target.value })} className={inputClase} />
                            <p className="text-xs text-slate-500 mt-1">Vacío = sin fecha de término</p>
                        </div>
                    </div>

                    {/* Vista previa */}
                    <div className="p-4 rounded-lg bg-slate-800 text-slate-100 text-sm">
                        <span className="text-slate-400 text-xs uppercase font-bold block mb-1">Así se aplicará</span>
                        {vistaPrevia}
                    </div>

                    {errores.length > 0 && (
                        <ul className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm list-disc pl-8">
                            {errores.map((err, i) => <li key={i}>{err}</li>)}
                        </ul>
                    )}

                    <div className="flex flex-wrap items-center justify-between gap-4 pt-4 border-t border-slate-100">
                        <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                            <input type="checkbox" checked={formulario.activa}
                                onChange={e => actualizar({ activa: e.target.checked })} className="w-4 h-4 accent-emerald-600" />
                            Promoción activa
                        </label>
                        <div className="flex gap-3">
                            {editandoId && (
                                <button type="button" onClick={cancelarEdicion}
                                    className="px-6 py-3 rounded-lg font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 cursor-pointer">
                                    Cancelar
                                </button>
                            )}
                            <button disabled={guardando} type="submit"
                                className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-6 py-3 rounded-lg font-bold transition-colors shadow-md disabled:opacity-50 cursor-pointer">
                                <Save className="w-5 h-5" /> {guardando ? 'Guardando...' : editandoId ? 'Guardar cambios' : 'Crear promoción'}
                            </button>
                        </div>
                    </div>
                </form>

                {/* ============ LISTADO ============ */}
                <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-x-auto">
                    <table className="w-full text-left">
                        <thead className="bg-slate-50 border-b border-gray-200 text-slate-500 text-sm">
                            <tr>
                                <th className="p-4 font-medium">Oferta</th>
                                <th className="p-4 font-medium">Regla</th>
                                <th className="p-4 font-medium text-center">Estado</th>
                                <th className="p-4 font-medium text-center">Acciones</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 text-sm">
                            {promociones.length === 0 && (
                                <tr><td colSpan="4" className="p-8 text-center text-slate-400">Aún no hay promociones.</td></tr>
                            )}
                            {promociones.map(promo => {
                                const estado = estadoVigencia(promo);
                                return (
                                    <tr key={promo.id} className={`hover:bg-slate-50 ${editandoId === promo.id ? 'bg-emerald-50' : ''}`}>
                                        <td className="p-4">
                                            <span className="font-bold text-slate-800 block">{promo.nombre}</span>
                                            <span className="text-xs text-slate-500">{TIPOS[promo.tipo_promocion]?.nombre}</span>
                                        </td>
                                        <td className="p-4 text-slate-600">{describirPromocion(promo, opciones.campos)}</td>
                                        <td className="p-4 text-center">
                                            <button onClick={() => alternarActiva(promo)}
                                                title={promo.activa ? 'Pausar' : 'Activar'}
                                                className={`px-3 py-1 rounded-full text-xs font-bold cursor-pointer ${estado.clase}`}>
                                                {estado.texto}
                                            </button>
                                        </td>
                                        <td className="p-4">
                                            <div className="flex justify-center gap-1">
                                                <button onClick={() => editar(promo)} title="Editar"
                                                    className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg cursor-pointer">
                                                    <Pencil className="w-5 h-5" />
                                                </button>
                                                <button onClick={() => handleEliminar(promo)} title="Eliminar"
                                                    className="p-2 text-red-500 hover:bg-red-50 rounded-lg cursor-pointer">
                                                    <Trash2 className="w-5 h-5" />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}
