import React, { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { iniciarLector } from '../../utils/lectorCodigos';

// La cámara lee el mismo código varias veces por segundo mientras está a la vista.
// Para volver a agregarlo (otra unidad igual) hay que sacarlo del cuadro al menos este tiempo.
const AUSENCIA_PARA_REPETIR_MS = 1000;

/**
 * Escáner de códigos de barras con la cámara. Queda abierto para escanear
 * varios productos seguidos; cada lectura llama a onCodigo(codigo), que
 * devuelve { ok, mensaje } para mostrarlo en pantalla.
 */
export default function ModalEscanerCamara({ onCodigo, onClose }) {
    const videoRef = useRef(null);
    const ultimo = useRef({ codigo: '', hora: 0 });
    const procesando = useRef(false);
    const onCodigoRef = useRef(onCodigo);
    const [estado, setEstado] = useState('iniciando');   // iniciando | leyendo | error
    const [error, setError] = useState('');
    const [aviso, setAviso] = useState(null);            // { ok, mensaje }
    const [agregados, setAgregados] = useState(0);

    useEffect(() => { onCodigoRef.current = onCodigo; }, [onCodigo]);

    useEffect(() => {
        let lector = null;
        let cancelado = false;

        const alLeer = async (codigo) => {
            const ahora = Date.now();
            const sigueAVista = codigo === ultimo.current.codigo && ahora - ultimo.current.hora < AUSENCIA_PARA_REPETIR_MS;
            ultimo.current = { codigo, hora: ahora };   // última vez que se vio este código
            if (sigueAVista || procesando.current) return;
            procesando.current = true;
            try {
                const resultado = await onCodigoRef.current(codigo);
                if (cancelado) return;
                setAviso(resultado);
                if (resultado.ok) {
                    setAgregados(n => n + 1);
                    navigator.vibrate?.(60);
                } else {
                    navigator.vibrate?.([40, 60, 40]);
                }
            } finally {
                procesando.current = false;
            }
        };

        iniciarLector(videoRef.current, alLeer)
            .then(l => {
                if (cancelado) { l.detener(); return; }
                lector = l;
                setEstado('leyendo');
            })
            .catch(e => {
                if (cancelado) return;
                setError(e.message);
                setEstado('error');
            });

        return () => { cancelado = true; lector?.detener(); };
    }, []);

    useEffect(() => {
        const onKey = (e) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);

    return (
        <div className="fixed inset-0 bg-black z-50 flex flex-col">
            <div className="flex items-center justify-between p-3 text-white pt-[max(0.75rem,env(safe-area-inset-top))]">
                <div>
                    <p className="font-bold">Escanear con la cámara</p>
                    <p className="text-xs text-slate-300">
                        {agregados > 0
                            ? `${agregados} ${agregados === 1 ? 'producto agregado' : 'productos agregados'} · para otra unidad igual, aleja la cámara y vuelve a apuntar`
                            : 'Apunta al código de barras'}
                    </p>
                </div>
                <button onClick={onClose} className="p-2 rounded-lg bg-white/10 hover:bg-white/20 cursor-pointer" aria-label="Cerrar cámara">
                    <X className="w-6 h-6" />
                </button>
            </div>

            <div className="relative flex-1 min-h-0 overflow-hidden">
                <video ref={videoRef} className="absolute inset-0 w-full h-full object-cover" playsInline muted />
                {estado === 'leyendo' && (
                    // Recuadro guía
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                        <div className="w-4/5 max-w-md h-36 border-4 border-white/80 rounded-xl shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
                    </div>
                )}
                {estado === 'iniciando' && (
                    <p className="absolute inset-0 flex items-center justify-center text-white">Abriendo la cámara...</p>
                )}
                {estado === 'error' && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center text-center text-white p-6 gap-4">
                        <p className="text-lg font-bold">No se pudo usar la cámara</p>
                        <p className="text-slate-300">{error}</p>
                        <button onClick={onClose} className="px-6 py-3 rounded-lg bg-white text-slate-900 font-bold cursor-pointer">Volver</button>
                    </div>
                )}
            </div>

            <div className="p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] space-y-2">
                {aviso && (
                    <p className={`p-3 rounded-lg text-sm font-medium ${aviso.ok ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white'}`}>
                        {aviso.mensaje}
                    </p>
                )}
                <button onClick={onClose} className="w-full py-3.5 rounded-xl bg-white text-slate-900 font-bold cursor-pointer">
                    Listo, ver la venta
                </button>
            </div>
        </div>
    );
}
