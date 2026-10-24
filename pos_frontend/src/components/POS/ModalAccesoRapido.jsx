import React, { useState, useEffect, useMemo } from 'react';
import { X, Search, Package } from 'lucide-react';

const peso = (n) => `$${Math.round(Number(n) || 0).toLocaleString('es-CL')}`;

// Miniatura liviana desde el CDN de Shopify (evita descargar la foto completa)
const miniatura = (url, ancho = 240) =>
    url ? `${url}${url.includes('?') ? '&' : '?'}width=${ancho}` : '';

const normalizar = (t) =>
    String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// Filtros del panel: etiquetas (Skinny, Fat...) o marcas, según el grupo.
// Solo se muestran los que agrupan a 2 o más productos.
const calcularFiltros = (productos, agruparPor) => {
    const conteo = new Map();
    for (const p of productos) {
        const valores = agruparPor === 'proveedor' ? [p.proveedor] : (p.etiquetas || []);
        for (const v of new Set(valores.filter(Boolean))) conteo.set(v, (conteo.get(v) || 0) + 1);
    }
    return [...conteo.entries()]
        .filter(([, n]) => n >= 2 && n < productos.length)
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([valor]) => valor);
};

/**
 * Panel con fotos para agregar a la venta productos que no se escanean
 * (caps, puntas). Se pueden agregar varios sin cerrar el panel.
 */
export default function ModalAccesoRapido({ grupo, enCarrito = {}, onAgregar, onClose }) {
    const [filtro, setFiltro] = useState('');
    const [texto, setTexto] = useState('');
    const [ultimo, setUltimo] = useState(null);

    useEffect(() => {
        const onKey = (e) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);

    const productos = grupo.productos;
    const filtros = useMemo(() => calcularFiltros(productos, grupo.agrupar_por), [productos, grupo.agrupar_por]);

    const visibles = useMemo(() => {
        const buscado = normalizar(texto.trim());
        return productos.filter(p => {
            if (filtro) {
                const valores = grupo.agrupar_por === 'proveedor' ? [p.proveedor] : (p.etiquetas || []);
                if (!valores.includes(filtro)) return false;
            }
            return !buscado || normalizar(p.nombre).includes(buscado);
        });
    }, [productos, filtro, texto, grupo.agrupar_por]);

    const agregar = (p) => {
        onAgregar(p);
        setUltimo(p.id_shopify);
        setTimeout(() => setUltimo(u => (u === p.id_shopify ? null : u)), 600);
    };

    const totalEnCarrito = productos.reduce((s, p) => s + (enCarrito[p.id_shopify] || 0), 0);

    return (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onClose}>
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl h-[88vh] flex flex-col" onClick={e => e.stopPropagation()}>

                <div className="p-4 border-b border-gray-200 space-y-3">
                    <div className="flex items-center justify-between gap-3">
                        <h3 className="text-xl font-bold text-slate-800">{grupo.nombre}</h3>
                        <div className="relative flex-1 max-w-xs">
                            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                            <input type="text" value={texto} onChange={e => setTexto(e.target.value)} autoFocus
                                placeholder={`Buscar en ${grupo.nombre.toLowerCase()}...`}
                                className="w-full pl-9 p-2 border border-gray-300 rounded-lg text-sm" />
                        </div>
                        <button onClick={onClose} className="p-2 rounded-lg hover:bg-gray-100 cursor-pointer" aria-label="Cerrar">
                            <X className="w-5 h-5" />
                        </button>
                    </div>
                    {filtros.length > 0 && (
                        <div className="flex flex-wrap gap-2">
                            {['', ...filtros].map(f => (
                                <button key={f || 'todos'} onClick={() => setFiltro(f)}
                                    className={`px-3 py-1.5 rounded-full text-sm font-medium cursor-pointer ${
                                        filtro === f ? 'bg-slate-900 text-white' : 'bg-gray-100 text-slate-700 hover:bg-gray-200'
                                    }`}>
                                    {f || 'Todos'}
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                <div className="flex-1 overflow-y-auto p-4 bg-gray-50">
                    {visibles.length === 0 && (
                        <p className="text-center text-slate-400 mt-10">No hay productos que coincidan.</p>
                    )}
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                        {visibles.map(p => {
                            const sinPrecio = !(p.precio > 0);
                            const cantidad = enCarrito[p.id_shopify] || 0;
                            return (
                                <button key={p.id_shopify} onClick={() => agregar(p)} disabled={sinPrecio}
                                    title={sinPrecio ? 'Este producto no tiene precio en Shopify' : `Agregar ${p.nombre}`}
                                    className={`relative text-left bg-white rounded-xl border overflow-hidden transition-all ${
                                        sinPrecio ? 'opacity-50 cursor-not-allowed border-gray-200'
                                            : 'cursor-pointer border-gray-200 hover:border-slate-900 hover:shadow-md active:scale-95'
                                    } ${ultimo === p.id_shopify ? 'ring-4 ring-emerald-400' : ''}`}>
                                    {cantidad > 0 && (
                                        <span className="absolute top-2 right-2 z-10 bg-emerald-600 text-white text-xs font-bold rounded-full min-w-6 h-6 px-1.5 flex items-center justify-center shadow">
                                            {cantidad}
                                        </span>
                                    )}
                                    <div className="aspect-square bg-gray-100 flex items-center justify-center">
                                        {p.imagen
                                            ? <img src={miniatura(p.imagen)} alt="" loading="lazy" className="w-full h-full object-cover" />
                                            : <Package className="w-10 h-10 text-gray-300" />}
                                    </div>
                                    <div className="p-2">
                                        <p className="text-sm font-semibold text-slate-800 leading-tight line-clamp-2 min-h-[2.5em]">{p.nombre}</p>
                                        <div className="flex items-center justify-between mt-1">
                                            <span className={`font-bold ${sinPrecio ? 'text-red-600 text-xs' : 'text-slate-900'}`}>
                                                {sinPrecio ? 'Sin precio' : peso(p.precio)}
                                            </span>
                                            <span className={`text-xs ${p.stock_disponible > 0 ? 'text-slate-500' : 'text-red-500'}`}>
                                                Stock {p.stock_disponible}
                                            </span>
                                        </div>
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                </div>

                <div className="p-4 border-t border-gray-200 flex items-center justify-between">
                    <span className="text-sm text-slate-500">
                        {totalEnCarrito > 0 ? `${totalEnCarrito} ${grupo.nombre.toLowerCase()} en la venta` : 'Toca un producto para agregarlo'}
                    </span>
                    <button onClick={onClose}
                        className="px-8 py-3 bg-slate-900 hover:bg-slate-800 text-white rounded-xl font-bold cursor-pointer">
                        Listo
                    </button>
                </div>
            </div>
        </div>
    );
}
