import React, { useState, useEffect, useCallback } from 'react';
import { documentosService } from '../services/api';
import { FileText, RefreshCw, AlertTriangle } from 'lucide-react';
import DetalleVentaModal from '../components/POS/DetalleVentaModal';
import { abrirPdfDocumento, ESTILO_ESTADO } from '../utils/documentos';

const peso = (n) => `$${Math.round(Number(n) || 0).toLocaleString('es-CL')}`;
const aISO = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const formatoFechaHora = (iso) =>
    new Date(iso).toLocaleString('es-CL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

/** Registro de boletas y facturas electrónicas emitidas desde la caja (solo admin). */
export default function Documentos() {
    const hoy = aISO(new Date());
    const [desde, setDesde] = useState(() => aISO(new Date(new Date().getFullYear(), new Date().getMonth(), 1)));
    const [hasta, setHasta] = useState(hoy);
    const [tipo, setTipo] = useState('');
    const [estado, setEstado] = useState('');

    const [config, setConfig] = useState(null);
    const [documentos, setDocumentos] = useState([]);
    const [siguiente, setSiguiente] = useState(null);
    const [cargando, setCargando] = useState(false);
    const [error, setError] = useState('');
    const [ocupado, setOcupado] = useState(null);   // id del documento en proceso
    const [ventaAbierta, setVentaAbierta] = useState(null);

    useEffect(() => { documentosService.configuracion().then(setConfig).catch(() => {}); }, []);

    const cargar = useCallback(async (pagina = 1) => {
        setCargando(true);
        setError('');
        try {
            const lista = await documentosService.listar({ desde, hasta, tipo, estado, page: pagina });
            setDocumentos(prev => (pagina === 1 ? lista.results : [...prev, ...lista.results]));
            setSiguiente(lista.next ? pagina + 1 : null);
        } catch (e) {
            setError(e.response?.data?.error || 'No se pudieron cargar los documentos.');
        } finally {
            setCargando(false);
        }
    }, [desde, hasta, tipo, estado]);

    useEffect(() => { cargar(1); }, [cargar]);

    const accion = async (doc, funcion) => {
        setOcupado(doc.id);
        try {
            const nuevo = await funcion(doc.id);
            setDocumentos(prev => prev.map(d => (d.id === nuevo.id ? nuevo : d)));
            if (nuevo.estado === 'ERROR') alert(`No se emitió: ${nuevo.error}`);
        } catch (e) {
            const datos = e.response?.data;
            // Envío antiguo sin respuesta: pudo emitirse, el admin confirma tras revisar OpenFactura
            if (datos?.requiere_confirmacion &&
                window.confirm(`${datos.error}\n\n¿Ya revisaste y quieres emitirlo de todas formas?`)) {
                setOcupado(null);
                return accion(doc, (id) => documentosService.reintentar(id, true));
            }
            if (!datos?.requiere_confirmacion) alert(datos?.error || 'No se pudo completar la acción.');
        } finally {
            setOcupado(null);
        }
    };

    const conError = documentos.filter(d => d.estado === 'ERROR').length;
    const boton = 'text-xs font-medium px-2 py-1 rounded border cursor-pointer disabled:opacity-50';

    return (
        <div className="p-6 bg-gray-50 min-h-screen">
            <div className="max-w-6xl mx-auto space-y-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <h2 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
                        <FileText className="w-7 h-7 text-blue-600" /> Boletas y facturas
                    </h2>
                    <button onClick={() => cargar(1)} disabled={cargando}
                        className="flex items-center gap-1 text-sm text-slate-600 hover:text-blue-700 cursor-pointer">
                        <RefreshCw className={`w-4 h-4 ${cargando ? 'animate-spin' : ''}`} /> Actualizar
                    </button>
                </div>

                {config && !config.activo && (
                    <div className="p-3 rounded-lg bg-slate-100 border border-slate-200 text-sm text-slate-700">
                        La emisión de boletas y facturas está <strong>desactivada</strong>. Se activa con
                        <code className="mx-1 px-1 bg-white rounded">OPENFACTURA_ACTIVO=true</code> en el archivo <code>.env</code> del servidor.
                    </div>
                )}
                {config?.ambiente === 'dev' && config.activo && (
                    <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-sm text-amber-800 flex gap-2">
                        <AlertTriangle className="w-5 h-5 shrink-0" />
                        Ambiente de <strong>pruebas</strong>: los documentos se emiten a nombre de la empresa de demostración
                        de Haulmer y no llegan al SII.
                    </div>
                )}

                <div className="bg-white rounded-xl border border-gray-200 p-4 flex flex-wrap gap-3 items-center text-sm">
                    <input type="date" value={desde} max={hasta} onChange={e => setDesde(e.target.value)}
                        className="p-2 border border-gray-300 rounded-lg" />
                    <span className="text-slate-400">a</span>
                    <input type="date" value={hasta} min={desde} onChange={e => setHasta(e.target.value)}
                        className="p-2 border border-gray-300 rounded-lg" />
                    <select value={tipo} onChange={e => setTipo(e.target.value)} className="p-2 border border-gray-300 rounded-lg bg-white">
                        <option value="">Todos los documentos</option>
                        <option value="39">Solo boletas</option>
                        <option value="33">Solo facturas</option>
                        <option value="61">Solo notas de crédito</option>
                    </select>
                    <select value={estado} onChange={e => setEstado(e.target.value)} className="p-2 border border-gray-300 rounded-lg bg-white">
                        <option value="">Todos los estados</option>
                        <option value="EMITIDO">Emitidos</option>
                        <option value="ERROR">Con error</option>
                        <option value="PENDIENTE">Pendientes</option>
                    </select>
                    {conError > 0 && !estado && (
                        <span className="text-red-700 font-medium">{conError} con error en la lista</span>
                    )}
                </div>

                {error && <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">{error}</div>}

                <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead className="bg-slate-50 border-b border-gray-200 text-slate-500">
                            <tr>
                                <th className="p-3 text-left font-medium">Fecha</th>
                                <th className="p-3 text-left font-medium">Documento</th>
                                <th className="p-3 text-left font-medium">Venta</th>
                                <th className="p-3 text-left font-medium">Cliente</th>
                                <th className="p-3 text-right font-medium">Monto</th>
                                <th className="p-3 text-left font-medium">Estado</th>
                                <th className="p-3 text-right font-medium">Acciones</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {!cargando && documentos.length === 0 && (
                                <tr><td colSpan="7" className="p-10 text-center text-slate-400">No hay documentos en este periodo.</td></tr>
                            )}
                            {documentos.map(d => (
                                <tr key={d.id} className="align-top">
                                    <td className="p-3 text-slate-600 whitespace-nowrap">{formatoFechaHora(d.creado)}</td>
                                    <td className="p-3">
                                        <span className="font-bold text-slate-800">{d.tipo_nombre}</span>
                                        {d.referencia_texto && <span className="block text-xs text-slate-500">de {d.referencia_texto}</span>}
                                        {d.folio && <span className="block text-xs text-slate-500">N° {d.folio}</span>}
                                        {d.ambiente === 'dev' && <span className="block text-[11px] font-bold text-amber-700">PRUEBAS</span>}
                                    </td>
                                    <td className="p-3">
                                        <button onClick={() => setVentaAbierta(d.venta)} className="font-bold text-blue-700 hover:underline cursor-pointer">
                                            #{d.venta}
                                        </button>
                                        <span className="block text-xs text-slate-500">{d.venta_metodo_pago}</span>
                                    </td>
                                    <td className="p-3 text-slate-600">
                                        {d.receptor_razon_social || <span className="text-slate-400">—</span>}
                                        {d.receptor_rut && <span className="block text-xs text-slate-500">{d.receptor_rut}</span>}
                                        {d.email && <span className="block text-xs text-slate-500">{d.email}</span>}
                                    </td>
                                    <td className="p-3 text-right font-bold text-slate-800">
                                        {peso(d.monto_total || d.venta_total)}
                                        {d.diferencia ? <span className="block text-[11px] font-normal text-slate-500">
                                            {d.tipo === 61 ? `devuelto ${peso(d.devolucion_total)}` : `venta ${peso(d.venta_total)}`}
                                        </span> : null}
                                    </td>
                                    <td className="p-3 max-w-[240px]">
                                        <span className={`text-xs font-bold px-2 py-0.5 rounded ${ESTILO_ESTADO[d.estado] || ''}`}>{d.estado_nombre}</span>
                                        {d.estado_sii && <span className="block text-xs text-slate-500 mt-1">SII: {d.estado_sii}</span>}
                                        {d.estado === 'ERROR' && d.error && <span className="block text-xs text-red-700 mt-1">{d.error}</span>}
                                        {d.advertencia && <span className="block text-xs text-amber-700 mt-1">{d.advertencia}</span>}
                                    </td>
                                    <td className="p-3">
                                        <div className="flex flex-wrap justify-end gap-1">
                                            {d.estado === 'EMITIDO' && (
                                                <>
                                                    <button onClick={() => abrirPdfDocumento(d.id)}
                                                        className={`${boton} border-gray-300 text-slate-700 hover:bg-gray-100`}>PDF</button>
                                                    <button onClick={() => accion(d, documentosService.actualizarEstado)} disabled={ocupado === d.id}
                                                        className={`${boton} border-gray-300 text-slate-700 hover:bg-gray-100`}>
                                                        {ocupado === d.id ? '...' : 'Consultar SII'}
                                                    </button>
                                                </>
                                            )}
                                            {(d.estado === 'ERROR' || d.estado === 'PENDIENTE') && (
                                                <button onClick={() => accion(d, documentosService.reintentar)} disabled={ocupado === d.id}
                                                    className={`${boton} border-blue-600 bg-blue-600 text-white hover:bg-blue-700`}>
                                                    {ocupado === d.id ? 'Emitiendo...' : 'Reintentar'}
                                                </button>
                                            )}
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    {(siguiente || cargando) && (
                        <div className="p-3 border-t border-gray-100 text-center">
                            {cargando
                                ? <span className="text-sm text-slate-400">Cargando...</span>
                                : <button onClick={() => cargar(siguiente)} className="text-sm font-medium text-blue-700 hover:underline cursor-pointer">Cargar más</button>}
                        </div>
                    )}
                </div>
            </div>

            {ventaAbierta && <DetalleVentaModal ventaId={ventaAbierta} onClose={() => setVentaAbierta(null)} onCambio={() => cargar(1)} />}
        </div>
    );
}
