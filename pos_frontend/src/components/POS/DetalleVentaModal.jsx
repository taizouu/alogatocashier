import React, { useState, useEffect, useCallback } from 'react';
import { ventasService } from '../../services/api';
import { X, ExternalLink, CheckCircle, AlertTriangle, Undo2, Minus, Plus, Receipt } from 'lucide-react';
import ModalComprobante from './ModalComprobante';
import { abrirPdfDocumento, ESTILO_ESTADO } from '../../utils/documentos';

const peso = (n) => `$${Math.round(Number(n) || 0).toLocaleString('es-CL')}`;

const MEDIOS = [
    { valor: 'EFECTIVO', nombre: 'Efectivo' },
    { valor: 'TARJETA_TUU', nombre: 'Tarjeta TUU' },
    { valor: 'TRANSFERENCIA', nombre: 'Transferencia' },
];

// Mismo cálculo que el backend (caja/reembolsos.py): se reembolsa lo pagado
// por esas unidades, y la última unidad de la línea se lleva el resto exacto.
const montoAReembolsar = (linea, cantidad) => {
    const restantes = linea.cantidad - linea.unidades_devueltas;
    if (cantidad <= 0 || cantidad > restantes) return 0;
    const dineroRestante = linea.total_cobrado - linea.monto_devuelto;
    if (cantidad === restantes) return dineroRestante;
    return Math.floor((2 * dineroRestante * cantidad + restantes) / (2 * restantes));
};

function FormularioDevolucion({ venta, onCancelar, onHecha }) {
    const lineas = venta.detalles.filter(d => d.cantidad - d.unidades_devueltas > 0);
    const [cantidades, setCantidades] = useState({});
    const [metodo, setMetodo] = useState(venta.metodo_pago);
    const [reponer, setReponer] = useState(true);
    const [motivo, setMotivo] = useState('');
    const [enviando, setEnviando] = useState(false);
    const [error, setError] = useState('');

    const cambiar = (linea, delta) => {
        const max = linea.cantidad - linea.unidades_devueltas;
        setCantidades(prev => ({ ...prev, [linea.id]: Math.min(max, Math.max(0, (prev[linea.id] || 0) + delta)) }));
    };
    const seleccionarTodo = () =>
        setCantidades(Object.fromEntries(lineas.map(l => [l.id, l.cantidad - l.unidades_devueltas])));

    const elegidos = lineas.filter(l => (cantidades[l.id] || 0) > 0);
    const total = elegidos.reduce((s, l) => s + montoAReembolsar(l, cantidades[l.id]), 0);
    const esTodo = lineas.length > 0 && lineas.every(l => cantidades[l.id] === l.cantidad - l.unidades_devueltas);

    const enviar = async () => {
        setError('');
        if (!elegidos.length) return setError('Elige al menos un producto.');
        if (!motivo.trim()) return setError('Indica el motivo.');
        const medio = MEDIOS.find(m => m.valor === metodo)?.nombre;
        if (!window.confirm(`¿${esTodo ? 'Anular la venta' : 'Registrar la devolución'} y reembolsar ${peso(total)} en ${medio}?`)) return;

        setEnviando(true);
        try {
            const respuesta = await ventasService.devolver(venta.id, {
                items: elegidos.map(l => ({ detalle_id: l.id, cantidad: cantidades[l.id] })),
                motivo: motivo.trim(),
                metodo_reembolso: metodo,
                repone_stock: reponer,
            });
            alert(`${respuesta.mensaje}: ${peso(respuesta.total_reembolsado)} en ${respuesta.metodo_reembolso}.` +
                  (respuesta.advertencia ? `\n\nAviso: ${respuesta.advertencia}` : ''));
            onHecha();
        } catch (e) {
            setError(e.response?.data?.error || 'No se pudo registrar la devolución.');
        } finally {
            setEnviando(false);
        }
    };

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <h4 className="font-bold text-slate-800">¿Qué productos se devuelven?</h4>
                <button onClick={seleccionarTodo} className="text-sm text-red-700 hover:underline cursor-pointer">
                    Anular venta completa
                </button>
            </div>

            <ul className="divide-y divide-gray-100 border border-gray-200 rounded-lg">
                {lineas.map(l => {
                    const restantes = l.cantidad - l.unidades_devueltas;
                    const n = cantidades[l.id] || 0;
                    return (
                        <li key={l.id} className="p-3 flex items-center justify-between gap-3">
                            <div className="min-w-0">
                                <span className="block text-slate-800 truncate">{l.nombre_producto || 'Producto'}</span>
                                <span className="text-xs text-slate-500">
                                    Se puede devolver: {restantes}{l.unidades_devueltas > 0 ? ` (ya devueltas ${l.unidades_devueltas})` : ''}
                                    {n > 0 && <> · reembolso {peso(montoAReembolsar(l, n))}</>}
                                </span>
                            </div>
                            <div className="flex items-center gap-2 flex-shrink-0">
                                <button onClick={() => cambiar(l, -1)} disabled={n === 0}
                                    className="p-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 disabled:opacity-40 cursor-pointer" aria-label="Menos">
                                    <Minus className="w-4 h-4" />
                                </button>
                                <span className="w-6 text-center font-bold">{n}</span>
                                <button onClick={() => cambiar(l, 1)} disabled={n === restantes}
                                    className="p-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 disabled:opacity-40 cursor-pointer" aria-label="Más">
                                    <Plus className="w-4 h-4" />
                                </button>
                            </div>
                        </li>
                    );
                })}
            </ul>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <label className="text-sm">
                    <span className="block text-slate-600 mb-1">Reembolsar en</span>
                    <select value={metodo} onChange={e => setMetodo(e.target.value)}
                        className="w-full p-2 border border-gray-300 rounded-lg bg-white">
                        {MEDIOS.map(m => <option key={m.valor} value={m.valor}>{m.nombre}</option>)}
                    </select>
                </label>
                <label className="text-sm">
                    <span className="block text-slate-600 mb-1">Motivo</span>
                    <input type="text" value={motivo} onChange={e => setMotivo(e.target.value)} maxLength={255}
                        placeholder="Ej: producto con falla, cliente se arrepintió"
                        className="w-full p-2 border border-gray-300 rounded-lg" />
                </label>
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                <input type="checkbox" checked={reponer} onChange={e => setReponer(e.target.checked)} className="w-4 h-4" />
                Reponer al stock (desmárcalo si el producto vuelve dañado)
            </label>
            {metodo === 'EFECTIVO' && (
                <p className="text-xs text-slate-500">El reembolso en efectivo sale de la caja abierta y se descuenta en su cierre.</p>
            )}

            {error && <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">{error}</div>}

            <div className="flex items-center justify-between gap-3 pt-2 border-t border-gray-100">
                <span className="text-lg">
                    A reembolsar: <strong className="text-red-700">{peso(total)}</strong>
                </span>
                <div className="flex gap-2">
                    <button onClick={onCancelar} disabled={enviando}
                        className="px-4 py-2 rounded-lg bg-gray-100 hover:bg-gray-200 font-medium cursor-pointer">
                        Volver
                    </button>
                    <button onClick={enviar} disabled={enviando || !elegidos.length}
                        className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white font-bold disabled:opacity-50 cursor-pointer">
                        {enviando ? 'Registrando...' : esTodo ? 'Anular venta' : 'Registrar devolución'}
                    </button>
                </div>
            </div>
        </div>
    );
}

export default function DetalleVentaModal({ ventaId, onClose, onCambio }) {
    const [venta, setVenta] = useState(null);
    const [error, setError] = useState('');
    const [devolviendo, setDevolviendo] = useState(false);
    const [verComprobante, setVerComprobante] = useState(false);

    const cargar = useCallback(() => {
        ventasService.detalle(ventaId).then(setVenta).catch(() => setError('No se pudo cargar la venta.'));
    }, [ventaId]);

    useEffect(() => {
        cargar();
        const onKey = (e) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [cargar, onClose]);

    const quedaPorDevolver = venta?.detalles.some(d => d.cantidad - d.unidades_devueltas > 0);

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
                <div className="p-5 border-b border-gray-200 flex items-start justify-between gap-4">
                    <div>
                        <h3 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                            Venta #{ventaId}
                            {venta?.estado === 'ANULADA' && <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full">Anulada</span>}
                            {venta?.estado === 'DEVOLUCION_PARCIAL' && <span className="text-xs bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full">Devolución parcial</span>}
                        </h3>
                        {venta && (
                            <p className="text-sm text-slate-500 mt-1">
                                {new Date(venta.fecha_hora).toLocaleString('es-CL')} · {venta.cajero} · {venta.metodo_pago_nombre}
                                {venta.pago_tuu && ` (${venta.pago_tuu.metodo.toLowerCase()} vía POS${venta.pago_tuu.codigo_operacion ? `, op. ${venta.pago_tuu.codigo_operacion}` : ''})`}
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

                    {venta && devolviendo && (
                        <FormularioDevolucion
                            venta={venta}
                            onCancelar={() => setDevolviendo(false)}
                            onHecha={() => { setDevolviendo(false); cargar(); onCambio?.(); }}
                        />
                    )}

                    {venta && !devolviendo && (
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
                                                    <span className="ml-2 text-[11px] font-bold bg-emerald-100 text-emerald-800 px-1.5 py-0.5 rounded">{d.promocion}</span>
                                                )}
                                                {d.unidades_devueltas > 0 && (
                                                    <span className="ml-2 text-[11px] font-bold bg-red-100 text-red-700 px-1.5 py-0.5 rounded">
                                                        {d.unidades_devueltas} devuelta{d.unidades_devueltas > 1 ? 's' : ''}
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
                                {venta.devuelto > 0 && (
                                    <div className="flex justify-between text-red-700 font-semibold"><span>Devuelto</span><span>−{peso(venta.devuelto)}</span></div>
                                )}
                                {venta.metodo_pago === 'EFECTIVO' && venta.monto_recibido != null && (<>
                                    <div className="flex justify-between text-slate-500"><span>Recibido</span><span>{peso(venta.monto_recibido)}</span></div>
                                    <div className="flex justify-between text-slate-500"><span>Vuelto</span><span>{peso(venta.vuelto)}</span></div>
                                </>)}
                            </div>

                            {venta.documentos?.length > 0 && (
                                <div className="mt-6">
                                    <h4 className="text-sm font-bold text-slate-500 uppercase mb-2">Boleta / factura</h4>
                                    <ul className="space-y-2">
                                        {venta.documentos.map(doc => (
                                            <li key={doc.id} className="p-3 rounded-lg bg-slate-50 border border-slate-200 text-sm flex flex-wrap items-center justify-between gap-2">
                                                <div>
                                                    <span className="font-semibold text-slate-800">
                                                        {doc.tipo_nombre}{doc.folio ? ` N° ${doc.folio}` : ''}
                                                    </span>{' '}
                                                    <span className={`text-xs font-bold px-2 py-0.5 rounded ${ESTILO_ESTADO[doc.estado] || ''}`}>{doc.estado_nombre}</span>
                                                    {doc.ambiente === 'dev' && <span className="ml-1 text-[11px] font-bold text-amber-700">PRUEBAS</span>}
                                                    {doc.receptor_razon_social && <p className="text-slate-600 text-xs mt-1">{doc.receptor_razon_social} · {doc.receptor_rut}</p>}
                                                    {doc.email && <p className="text-slate-500 text-xs">Enviado a {doc.email}</p>}
                                                    {doc.estado === 'ERROR' && <p className="text-red-700 text-xs mt-1">{doc.error} (reintentar en Boletas y facturas)</p>}
                                                </div>
                                                {doc.estado === 'EMITIDO' && (
                                                    <button onClick={() => abrirPdfDocumento(doc.id)}
                                                        className="px-3 py-1.5 rounded-lg border border-gray-300 bg-white hover:bg-gray-50 font-medium cursor-pointer">
                                                        Ver PDF
                                                    </button>
                                                )}
                                            </li>
                                        ))}
                                    </ul>
                                    {venta.devoluciones.length > 0 && venta.documentos.some(d => d.estado === 'EMITIDO') && (
                                        <p className="text-xs text-amber-700 mt-2">
                                            Esta venta tiene devoluciones: la nota de crédito todavía se emite desde OpenFactura.
                                        </p>
                                    )}
                                </div>
                            )}

                            {venta.devoluciones.length > 0 && (
                                <div className="mt-6">
                                    <h4 className="text-sm font-bold text-slate-500 uppercase mb-2">Devoluciones</h4>
                                    <ul className="space-y-2">
                                        {venta.devoluciones.map(dv => (
                                            <li key={dv.id} className="p-3 rounded-lg bg-red-50 border border-red-100 text-sm">
                                                <div className="flex justify-between gap-3">
                                                    <span className="font-semibold text-red-800">
                                                        {dv.es_anulacion ? 'Anulación' : 'Devolución'} #{dv.id} · {peso(dv.total)} en {dv.metodo_reembolso_nombre}
                                                    </span>
                                                    <span className="text-slate-500">{new Date(dv.fecha_hora).toLocaleString('es-CL')} · {dv.usuario}</span>
                                                </div>
                                                <p className="text-slate-600 mt-1">
                                                    {dv.productos.map(p => `${p.cantidad}× ${p.nombre}`).join(', ')} — <em>{dv.motivo}</em>
                                                    {!dv.repone_stock && ' · sin reponer stock'}
                                                </p>
                                                {dv.aviso_shopify && <p className="text-amber-700 text-xs mt-1">⚠ {dv.aviso_shopify}</p>}
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            )}
                        </>
                    )}
                </div>

                {venta && !devolviendo && (
                    <div className="p-4 border-t border-gray-200 flex flex-wrap items-center justify-between gap-3 text-sm">
                        {venta.sincronizado_shopify ? (
                            <span className="flex items-center gap-1 text-green-700"><CheckCircle className="w-4 h-4" /> Registrada en Shopify</span>
                        ) : (
                            <span className="flex items-center gap-1 text-amber-700"><AlertTriangle className="w-4 h-4" /> No se registró en Shopify</span>
                        )}
                        <div className="flex gap-2">
                            {venta.url_shopify && (
                                <a href={venta.url_shopify} target="_blank" rel="noopener noreferrer"
                                    className="flex items-center gap-1 px-3 py-2 rounded-lg border border-gray-300 hover:bg-gray-50 font-medium">
                                    Ver en Shopify <ExternalLink className="w-4 h-4" />
                                </a>
                            )}
                            <button onClick={() => setVerComprobante(true)}
                                className="flex items-center gap-1 px-3 py-2 rounded-lg border border-gray-300 hover:bg-gray-50 font-medium cursor-pointer">
                                <Receipt className="w-4 h-4" /> Comprobante
                            </button>
                            {quedaPorDevolver && (
                                <button onClick={() => setDevolviendo(true)}
                                    className="flex items-center gap-1 px-3 py-2 rounded-lg border border-red-300 text-red-700 hover:bg-red-50 font-medium cursor-pointer">
                                    <Undo2 className="w-4 h-4" /> Devolver / anular
                                </button>
                            )}
                        </div>
                    </div>
                )}
            </div>
            {verComprobante && (
                <div onClick={e => e.stopPropagation()}>
                    <ModalComprobante ventaId={ventaId} esCopia onClose={() => setVerComprobante(false)} />
                </div>
            )}
        </div>
    );
}
