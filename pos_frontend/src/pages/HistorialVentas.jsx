import React, { useState, useEffect, useCallback } from 'react';
import { ventasService } from '../services/api';
import { Receipt, Search, X, ExternalLink, CheckCircle, AlertTriangle, RefreshCw } from 'lucide-react';

const METODOS = [
    { valor: '', nombre: 'Todos los medios' },
    { valor: 'EFECTIVO', nombre: 'Efectivo' },
    { valor: 'TARJETA_TUU', nombre: 'Tarjeta TUU' },
    { valor: 'TRANSFERENCIA', nombre: 'Transferencia' },
];

const peso = (n) => `$${Math.round(Number(n) || 0).toLocaleString('es-CL')}`;

// Fecha local en formato AAAA-MM-DD (la que espera la API)
const aISO = (d) => {
    const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
    return z.toISOString().slice(0, 10);
};
const sumarDias = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

const RANGOS = {
    hoy: { nombre: 'Hoy', calcular: () => { const h = aISO(new Date()); return [h, h]; } },
    ayer: { nombre: 'Ayer', calcular: () => { const a = aISO(sumarDias(new Date(), -1)); return [a, a]; } },
    semana: { nombre: 'Últimos 7 días', calcular: () => [aISO(sumarDias(new Date(), -6)), aISO(new Date())] },
    mes: {
        nombre: 'Este mes',
        calcular: () => { const h = new Date(); return [aISO(new Date(h.getFullYear(), h.getMonth(), 1)), aISO(h)]; },
    },
};

const formatoFechaHora = (iso) =>
    new Date(iso).toLocaleString('es-CL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

function Tarjeta({ titulo, valor, detalle, destacado }) {
    return (
        <div className={`rounded-xl border p-4 ${destacado ? 'bg-slate-900 border-slate-900 text-white' : 'bg-white border-gray-200'}`}>
            <span className={`text-xs font-bold uppercase ${destacado ? 'text-slate-300' : 'text-slate-500'}`}>{titulo}</span>
            <div className={`text-2xl font-black mt-1 ${destacado ? 'text-white' : 'text-slate-800'}`}>{valor}</div>
            {detalle && <div className={`text-xs mt-1 ${destacado ? 'text-slate-300' : 'text-slate-500'}`}>{detalle}</div>}
        </div>
    );
}

function DetalleVenta({ ventaId, onClose }) {
    const [venta, setVenta] = useState(null);
    const [error, setError] = useState('');

    useEffect(() => {
        ventasService.detalle(ventaId).then(setVenta).catch(() => setError('No se pudo cargar la venta.'));
        const onKey = (e) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [ventaId, onClose]);

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
                <div className="p-5 border-b border-gray-200 flex items-start justify-between gap-4">
                    <div>
                        <h3 className="text-xl font-bold text-slate-800">Venta #{ventaId}</h3>
                        {venta && (
                            <p className="text-sm text-slate-500 mt-1">
                                {new Date(venta.fecha_hora).toLocaleString('es-CL')} · {venta.cajero} · {venta.metodo_pago_nombre}
                            </p>
                        )}
                    </div>
                    <button onClick={onClose} className="p-2 rounded-lg hover:bg-gray-100 cursor-pointer" aria-label="Cerrar">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <div className="p-5 overflow-y-auto flex-1">
                    {error && <p className="text-red-600">{error}</p>}
                    {!venta && !error && <p className="text-slate-500">Cargando...</p>}
                    {venta && (
                        <>
                            <table className="w-full text-sm">
                                <thead className="text-slate-500 border-b border-gray-200">
                                    <tr>
                                        <th className="py-2 text-left font-medium">Producto</th>
                                        <th className="py-2 text-center font-medium">Cant.</th>
                                        <th className="py-2 text-right font-medium">Precio normal</th>
                                        <th className="py-2 text-right font-medium">Cobrado</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100">
                                    {venta.detalles.map(d => (
                                        <tr key={d.id}>
                                            <td className="py-2 pr-2">
                                                <span className="text-slate-800 block">{d.nombre_producto || 'Producto sin nombre'}</span>
                                                <span className="text-xs text-slate-400 font-mono">{d.sku || d.codigo_barras || ''}</span>
                                                {d.promocion && (
                                                    <span className="ml-2 text-[11px] font-bold bg-emerald-100 text-emerald-800 px-1.5 py-0.5 rounded">
                                                        {d.promocion}
                                                    </span>
                                                )}
                                            </td>
                                            <td className="py-2 text-center">{d.cantidad}</td>
                                            <td className="py-2 text-right text-slate-500">{peso(d.total_normal)}</td>
                                            <td className="py-2 text-right font-semibold">{peso(d.total_cobrado)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>

                            <div className="mt-4 ml-auto max-w-xs space-y-1 text-sm">
                                {venta.descuento > 0 && (<>
                                    <div className="flex justify-between text-slate-500"><span>Precio normal</span><span>{peso(venta.total_normal)}</span></div>
                                    <div className="flex justify-between text-emerald-700"><span>Descuentos</span><span>−{peso(venta.descuento)}</span></div>
                                </>)}
                                <div className="flex justify-between text-lg font-black text-slate-800 border-t pt-1"><span>Total</span><span>{peso(venta.total)}</span></div>
                                {venta.metodo_pago === 'EFECTIVO' && venta.monto_recibido != null && (<>
                                    <div className="flex justify-between text-slate-500"><span>Recibido</span><span>{peso(venta.monto_recibido)}</span></div>
                                    <div className="flex justify-between text-slate-500"><span>Vuelto</span><span>{peso(venta.vuelto)}</span></div>
                                </>)}
                            </div>
                        </>
                    )}
                </div>

                {venta && (
                    <div className="p-4 border-t border-gray-200 flex items-center justify-between gap-3 text-sm">
                        {venta.sincronizado_shopify ? (
                            <span className="flex items-center gap-1 text-green-700"><CheckCircle className="w-4 h-4" /> Registrada en Shopify</span>
                        ) : (
                            <span className="flex items-center gap-1 text-amber-700"><AlertTriangle className="w-4 h-4" /> No se registró en Shopify</span>
                        )}
                        {venta.url_shopify && (
                            <a href={venta.url_shopify} target="_blank" rel="noopener noreferrer"
                                className="flex items-center gap-1 px-3 py-2 rounded-lg border border-gray-300 hover:bg-gray-50 font-medium">
                                Ver en Shopify <ExternalLink className="w-4 h-4" />
                            </a>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}

export default function HistorialVentas() {
    const [rango, setRango] = useState('hoy');
    const [desde, setDesde] = useState(() => RANGOS.hoy.calcular()[0]);
    const [hasta, setHasta] = useState(() => RANGOS.hoy.calcular()[1]);
    const [metodo, setMetodo] = useState('');
    const [texto, setTexto] = useState('');
    const [busqueda, setBusqueda] = useState('');   // texto con espera, para no consultar en cada tecla

    const [ventas, setVentas] = useState([]);
    const [siguiente, setSiguiente] = useState(null);
    const [resumen, setResumen] = useState(null);
    const [cargando, setCargando] = useState(false);
    const [error, setError] = useState('');
    const [ventaAbierta, setVentaAbierta] = useState(null);

    useEffect(() => {
        const t = setTimeout(() => setBusqueda(texto.trim()), 400);
        return () => clearTimeout(t);
    }, [texto]);


    const cargar = useCallback(async (pagina = 1) => {
        setCargando(true);
        setError('');
        try {
            const f = { desde, hasta, metodo_pago: metodo, q: busqueda };
            const [lista, totales] = await Promise.all([
                ventasService.listar({ ...f, page: pagina }),
                pagina === 1 ? ventasService.resumen(f) : Promise.resolve(null),
            ]);
            setVentas(prev => (pagina === 1 ? lista.results : [...prev, ...lista.results]));
            setSiguiente(lista.next ? pagina + 1 : null);
            if (totales) setResumen(totales);
        } catch (e) {
            setError(e.response?.data?.error || 'No se pudo cargar el historial.');
        } finally {
            setCargando(false);
        }
    }, [desde, hasta, metodo, busqueda]);

    useEffect(() => { cargar(1); }, [cargar]);

    const elegirRango = (clave) => {
        setRango(clave);
        if (RANGOS[clave]) {
            const [d, h] = RANGOS[clave].calcular();
            setDesde(d);
            setHasta(h);
        }
    };

    const cerrarDetalle = useCallback(() => setVentaAbierta(null), []);
    const hayFiltros = metodo || busqueda;

    return (
        <div className="p-6 bg-gray-50 min-h-screen">
            <div className="max-w-6xl mx-auto space-y-5">

                <div className="flex flex-wrap items-center justify-between gap-3">
                    <h2 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
                        <Receipt className="w-7 h-7 text-blue-600" /> Historial de ventas
                    </h2>
                    <button onClick={() => cargar(1)} disabled={cargando}
                        className="flex items-center gap-1 text-sm text-slate-600 hover:text-blue-700 cursor-pointer">
                        <RefreshCw className={`w-4 h-4 ${cargando ? 'animate-spin' : ''}`} /> Actualizar
                    </button>
                </div>

                {/* ---------- Filtros ---------- */}
                <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
                    <div className="flex flex-wrap gap-2">
                        {[...Object.entries(RANGOS), ['personalizado', { nombre: 'Otro rango' }]].map(([clave, r]) => (
                            <button key={clave} onClick={() => elegirRango(clave)}
                                className={`px-3 py-1.5 rounded-lg text-sm font-medium cursor-pointer ${
                                    rango === clave ? 'bg-blue-600 text-white' : 'bg-gray-100 text-slate-700 hover:bg-gray-200'
                                }`}>
                                {r.nombre}
                            </button>
                        ))}
                    </div>
                    <div className="flex flex-wrap gap-3 items-center">
                        {rango === 'personalizado' && (
                            <div className="flex items-center gap-2 text-sm">
                                <input type="date" value={desde} max={hasta} onChange={e => setDesde(e.target.value)}
                                    className="p-2 border border-gray-300 rounded-lg" />
                                <span className="text-slate-400">a</span>
                                <input type="date" value={hasta} min={desde} onChange={e => setHasta(e.target.value)}
                                    className="p-2 border border-gray-300 rounded-lg" />
                            </div>
                        )}
                        <select value={metodo} onChange={e => setMetodo(e.target.value)}
                            className="p-2 border border-gray-300 rounded-lg text-sm bg-white">
                            {METODOS.map(m => <option key={m.valor} value={m.valor}>{m.nombre}</option>)}
                        </select>
                        <div className="relative flex-1 min-w-[220px]">
                            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                            <input type="text" value={texto} onChange={e => setTexto(e.target.value)}
                                placeholder="N° de venta (#123), producto, SKU o código"
                                className="w-full pl-9 p-2 border border-gray-300 rounded-lg text-sm" />
                        </div>
                    </div>
                </div>

                {error && <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">{error}</div>}

                {/* ---------- Resumen ---------- */}
                {resumen && (
                    <div className="space-y-3">
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                            <Tarjeta destacado titulo={hayFiltros ? 'Total (filtrado)' : 'Total vendido'} valor={peso(resumen.total)}
                                detalle={`${resumen.cantidad_ventas} ${resumen.cantidad_ventas === 1 ? 'venta' : 'ventas'}`} />
                            <Tarjeta titulo="Ticket promedio" valor={peso(resumen.ticket_promedio)} />
                            <Tarjeta titulo="Unidades vendidas" valor={resumen.unidades.toLocaleString('es-CL')} />
                            <Tarjeta titulo="Descuentos" valor={peso(resumen.descuentos)} detalle="por promociones" />
                        </div>
                        {resumen.por_metodo.length > 0 && (
                            <div className="flex flex-wrap gap-2">
                                {resumen.por_metodo.map(m => (
                                    <span key={m.metodo_pago} className="bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm">
                                        <span className="text-slate-500">{m.nombre}:</span>{' '}
                                        <strong className="text-slate-800">{peso(m.total)}</strong>{' '}
                                        <span className="text-slate-400">({m.cantidad})</span>
                                    </span>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {/* ---------- Listado ---------- */}
                <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead className="bg-slate-50 border-b border-gray-200 text-slate-500">
                            <tr>
                                <th className="p-3 text-left font-medium">N°</th>
                                <th className="p-3 text-left font-medium">Fecha</th>
                                <th className="p-3 text-left font-medium">Cajero</th>
                                <th className="p-3 text-center font-medium">Unid.</th>
                                <th className="p-3 text-left font-medium">Medio de pago</th>
                                <th className="p-3 text-right font-medium">Descuento</th>
                                <th className="p-3 text-right font-medium">Total</th>
                                <th className="p-3 text-center font-medium">Shopify</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {!cargando && ventas.length === 0 && (
                                <tr><td colSpan="8" className="p-10 text-center text-slate-400">No hay ventas en este periodo.</td></tr>
                            )}
                            {ventas.map(v => (
                                <tr key={v.id} onClick={() => setVentaAbierta(v.id)}
                                    className="hover:bg-blue-50 cursor-pointer">
                                    <td className="p-3 font-bold text-slate-700">#{v.id}</td>
                                    <td className="p-3 text-slate-600">{formatoFechaHora(v.fecha_hora)}</td>
                                    <td className="p-3 text-slate-600">{v.cajero}</td>
                                    <td className="p-3 text-center text-slate-600">{v.unidades ?? 0}</td>
                                    <td className="p-3 text-slate-600">{v.metodo_pago_nombre}</td>
                                    <td className="p-3 text-right text-emerald-700">{v.descuento > 0 ? `−${peso(v.descuento)}` : ''}</td>
                                    <td className="p-3 text-right font-bold text-slate-800">{peso(v.total)}</td>
                                    <td className="p-3 text-center">
                                        {v.sincronizado_shopify
                                            ? <CheckCircle className="w-4 h-4 text-green-600 inline" aria-label="Registrada en Shopify" />
                                            : <AlertTriangle className="w-4 h-4 text-amber-500 inline" aria-label="No registrada en Shopify" />}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    {(siguiente || cargando) && (
                        <div className="p-3 border-t border-gray-100 text-center">
                            {cargando
                                ? <span className="text-sm text-slate-400">Cargando...</span>
                                : <button onClick={() => cargar(siguiente)} className="text-sm font-medium text-blue-700 hover:underline cursor-pointer">Cargar más ventas</button>}
                        </div>
                    )}
                </div>
            </div>

            {ventaAbierta && <DetalleVenta ventaId={ventaAbierta} onClose={cerrarDetalle} />}
        </div>
    );
}
