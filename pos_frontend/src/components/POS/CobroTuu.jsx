import React, { useState, useEffect, useRef } from 'react';
import { pagoRemotoService } from '../../services/api';
import { CheckCircle, AlertTriangle, RefreshCw } from 'lucide-react';

const EN_CURSO = ['PENDIENTE', 'ENVIADO', 'PROCESANDO'];
const INTERVALO_MS = 2500;
const peso = (n) => `$${Math.round(Number(n) || 0).toLocaleString('es-CL')}`;
const hora = (iso) => new Date(iso).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' });

/**
 * Cobro con tarjeta enviado al POS TUU (Pago remoto).
 * - Envía el monto al POS y consulta el estado hasta que el cliente pague.
 * - Con el pago aprobado llama a onAprobado(pago) para registrar la venta.
 * - Muestra los cobros aprobados que quedaron sin venta (p. ej. se cortó la red)
 *   para usarlos en vez de cobrarle de nuevo al cliente.
 * onEnCurso(true/false) avisa al modal para que no se cierre a mitad de un cobro.
 */
export default function CobroTuu({ total, onAprobado, onEnCurso, onCobroManual, bloqueado }) {
    const [metodo, setMetodo] = useState('DEBITO');
    const [pago, setPago] = useState(null);
    const [enviando, setEnviando] = useState(false);
    const [error, setError] = useState('');
    const [sinVenta, setSinVenta] = useState([]);
    const avisado = useRef(null);   // id del pago ya entregado a onAprobado

    const enCurso = !!pago && EN_CURSO.includes(pago.estado);

    useEffect(() => { onEnCurso?.(enCurso || enviando); }, [enCurso, enviando, onEnCurso]);

    useEffect(() => {
        pagoRemotoService.sinVenta().then(setSinVenta).catch(() => {});
    }, []);

    // Consulta del estado mientras el cliente pasa la tarjeta
    useEffect(() => {
        if (!enCurso) return undefined;
        let activo = true;
        const t = setInterval(async () => {
            try {
                const nuevo = await pagoRemotoService.estado(pago.id);
                if (activo) setPago(nuevo);
            } catch { /* corte momentáneo: se reintenta en la próxima vuelta */ }
        }, INTERVALO_MS);
        return () => { activo = false; clearInterval(t); };
    }, [enCurso, pago?.id]);

    // Pago aprobado → registrar la venta (una sola vez por pago)
    useEffect(() => {
        if (pago?.estado === 'COMPLETADO' && avisado.current !== pago.id) {
            avisado.current = pago.id;
            onAprobado(pago);
        }
    }, [pago, onAprobado]);

    const enviar = async () => {
        setError('');
        setEnviando(true);
        try {
            setPago(await pagoRemotoService.crear(total, metodo));
        } catch (e) {
            const datos = e.response?.data;
            setError(datos?.error || 'No se pudo enviar el cobro al POS.');
            // 409: ya había un cobro en curso por el mismo monto → se sigue ese
            if (datos?.pago && e.response?.status === 409 && datos.pago.monto === Math.round(total)) {
                setPago(datos.pago);
            }
        } finally {
            setEnviando(false);
        }
    };

    const usarAprobado = (p) => { avisado.current = p.id; onAprobado(p); };

    return (
        <div className="mb-4 p-4 rounded-lg bg-slate-50 border border-slate-200 space-y-3">
            {/* Cobros aprobados que no alcanzaron a registrarse como venta */}
            {sinVenta.length > 0 && !pago && (
                <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-sm space-y-2">
                    <p className="font-bold text-amber-900">Cobros aprobados en el POS sin venta registrada</p>
                    {sinVenta.map(p => (
                        <div key={p.id} className="flex items-center justify-between gap-2">
                            <span className="text-amber-900">
                                {peso(p.monto)} · {p.metodo_nombre} · {hora(p.creado)}
                                {p.codigo_operacion && ` · op. ${p.codigo_operacion}`}
                            </span>
                            {p.monto === Math.round(total) ? (
                                <button onClick={() => usarAprobado(p)} disabled={bloqueado}
                                    className="px-2 py-1 rounded bg-amber-600 text-white text-xs font-bold hover:bg-amber-700 cursor-pointer disabled:opacity-50">
                                    Usar este cobro
                                </button>
                            ) : (
                                <span className="text-xs text-amber-700">otro monto</span>
                            )}
                        </div>
                    ))}
                    <p className="text-xs text-amber-800">Si alguno fue un error, anúlalo en el POS.</p>
                </div>
            )}

            {!enCurso && pago?.estado !== 'COMPLETADO' && (
                <>
                    <div className="grid grid-cols-2 gap-2">
                        {[['DEBITO', 'Débito'], ['CREDITO', 'Crédito']].map(([valor, nombre]) => (
                            <button key={valor} type="button" onClick={() => setMetodo(valor)}
                                className={`p-2 rounded font-medium border cursor-pointer ${
                                    metodo === valor ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-100'
                                }`}>
                                {nombre}
                            </button>
                        ))}
                    </div>
                    <button type="button" onClick={enviar} disabled={enviando || bloqueado}
                        className="w-full p-3 rounded-lg bg-blue-600 text-white font-bold hover:bg-blue-700 disabled:opacity-50 cursor-pointer">
                        {enviando ? 'Enviando al POS...' : `${pago ? 'Enviar de nuevo' : 'Cobrar'} ${peso(total)} en el POS`}
                    </button>
                </>
            )}

            {enCurso && (
                <div className="text-center space-y-2">
                    <RefreshCw className="w-8 h-8 text-blue-600 animate-spin mx-auto" />
                    <p className="font-bold text-slate-800">{pago.estado_nombre}</p>
                    <p className="text-sm text-slate-600">
                        El cliente debe pasar su tarjeta ({pago.metodo_nombre.toLowerCase()}) en el POS por {peso(pago.monto)}.
                    </p>
                    {pago.error && <p className="text-xs text-slate-500">{pago.error}</p>}
                    <button type="button"
                        onClick={() => {
                            if (window.confirm('¿Dejar de esperar? Si el cliente igual completa el pago, ' +
                                'aparecerá como "cobro aprobado sin venta" para registrarlo después.')) {
                                setPago(null);
                            }
                        }}
                        className="text-xs text-slate-500 underline cursor-pointer">
                        Dejar de esperar
                    </button>
                </div>
            )}

            {pago?.estado === 'COMPLETADO' && (
                <p className="flex items-center justify-center gap-2 font-bold text-green-700">
                    <CheckCircle className="w-5 h-5" /> Pago aprobado{pago.codigo_operacion && ` (op. ${pago.codigo_operacion})`}
                </p>
            )}

            {pago && ['FALLIDO', 'CANCELADO', 'ERROR'].includes(pago.estado) && (
                <p className="flex items-start gap-2 text-sm text-red-700">
                    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span><strong>{pago.estado_nombre}.</strong> {pago.error}</span>
                </p>
            )}
            {error && !(pago && pago.error === error) && (
                <p className="flex items-start gap-2 text-sm text-red-700">
                    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /> {error}
                </p>
            )}

            {!enCurso && pago?.estado !== 'COMPLETADO' && (
                <button type="button" onClick={onCobroManual} className="block mx-auto text-xs text-slate-500 underline cursor-pointer">
                    El POS no responde: ya cobré a mano en el POS
                </button>
            )}
        </div>
    );
}
