import React, { useState, useEffect, useMemo, useRef } from 'react';
import { ventasService } from '../../services/api';
import { htmlComprobante, imprimirHTML } from '../../utils/comprobante';
import { abrirPdfDocumento } from '../../utils/documentos';
import { X, Receipt } from 'lucide-react';

// Preferencias de impresión de este equipo (cada caja puede tener otra impresora)
const leerPreferencia = (clave, porDefecto) => {
    try { return localStorage.getItem(clave) ?? porDefecto; } catch { return porDefecto; }
};
const guardarPreferencia = (clave, valor) => {
    try { localStorage.setItem(clave, valor); } catch { /* sin almacenamiento: se usa el valor por defecto */ }
};

/**
 * Comprobante de una venta: vista previa idéntica a lo impreso + botón imprimir.
 * - Tras una venta (esCopia = false): ofrece imprimir automáticamente.
 * - Desde el historial (esCopia = true): se marca como COPIA.
 */
export default function ModalComprobante({ ventaId, esCopia = false, onClose, textoCerrar = 'Cerrar' }) {
    const [datos, setDatos] = useState(null);
    const [error, setError] = useState('');
    const [ancho, setAncho] = useState(() => leerPreferencia('comprobante_ancho', '80'));
    const [auto, setAuto] = useState(() => leerPreferencia('comprobante_auto', 'no') === 'si');
    const yaImpreso = useRef(false);

    useEffect(() => {
        ventasService.comprobante(ventaId)
            .then(setDatos)
            .catch(e => setError(e.response?.status === 404
                ? 'No tienes acceso a esta venta.'
                : 'No se pudo cargar el comprobante.'));
    }, [ventaId]);

    useEffect(() => {
        const onKey = (e) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);

    const html = useMemo(
        () => (datos ? htmlComprobante(datos, { ancho, copia: esCopia }) : ''),
        [datos, ancho, esCopia]
    );

    // Impresión automática al terminar una venta (si el equipo lo tiene activado)
    useEffect(() => {
        if (html && auto && !esCopia && !yaImpreso.current) {
            yaImpreso.current = true;
            imprimirHTML(html);
        }
    }, [html, auto, esCopia]);

    // Boleta o factura electrónica emitida para esta venta (si hay)
    const documento = datos?.venta?.documentos?.find(d => d.tipo !== 61 && d.estado === 'EMITIDO');
    const documentoConError = datos?.venta?.documentos?.find(d => d.tipo !== 61 && d.estado === 'ERROR');

    const cambiarAncho = (valor) => { setAncho(valor); guardarPreferencia('comprobante_ancho', valor); };
    const cambiarAuto = (valor) => { setAuto(valor); guardarPreferencia('comprobante_auto', valor ? 'si' : 'no'); };

    return (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-2 sm:p-4" onClick={onClose}>
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-md max-h-[92dvh] flex flex-col" onClick={e => e.stopPropagation()}>
                <div className="p-4 border-b border-gray-200 flex items-center justify-between">
                    <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                        <Receipt className="w-5 h-5 text-blue-600" />
                        {esCopia ? `Comprobante venta #${ventaId}` : `Venta #${ventaId} registrada`}
                    </h3>
                    <button onClick={onClose} className="p-2 rounded-lg hover:bg-gray-100 cursor-pointer" aria-label="Cerrar">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto bg-gray-100 p-4 flex justify-center">
                    {error && <p className="text-red-600 self-center">{error}</p>}
                    {!datos && !error && <p className="text-slate-500 self-center">Cargando comprobante...</p>}
                    {html && (
                        <iframe
                            title="Vista previa del comprobante"
                            srcDoc={html}
                            sandbox=""
                            className="bg-white shadow border-0"
                            style={{ width: ancho === '58' ? '240px' : '320px', height: '560px' }}
                        />
                    )}
                </div>

                <div className="p-4 border-t border-gray-200 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-slate-600">
                        <label className="flex items-center gap-2">
                            Papel
                            <select value={ancho} onChange={e => cambiarAncho(e.target.value)}
                                className="p-1.5 border border-gray-300 rounded-lg bg-white">
                                <option value="80">80 mm</option>
                                <option value="58">58 mm</option>
                            </select>
                        </label>
                        {!esCopia && (
                            <label className="flex items-center gap-2 cursor-pointer">
                                <input type="checkbox" checked={auto} onChange={e => cambiarAuto(e.target.checked)} className="w-4 h-4" />
                                Imprimir siempre al terminar
                            </label>
                        )}
                    </div>
                    {documento && (
                        <button onClick={() => abrirPdfDocumento(documento.id)}
                            className="w-full p-2.5 rounded-lg border border-blue-600 text-blue-700 hover:bg-blue-50 font-bold cursor-pointer">
                            Ver {documento.tipo_nombre.toLowerCase()}{documento.folio ? ` N° ${documento.folio}` : ''}
                            {documento.ambiente === 'dev' ? ' (pruebas)' : ''}
                        </button>
                    )}
                    {!documento && documentoConError && (
                        <p className="text-xs text-red-700">La {documentoConError.tipo_nombre.toLowerCase()} no se emitió: {documentoConError.error}</p>
                    )}
                    <div className="flex gap-2">
                        <button onClick={() => imprimirHTML(html)} disabled={!html}
                            className="flex-1 bg-slate-900 hover:bg-slate-800 text-white p-3 rounded-lg font-bold disabled:opacity-50 cursor-pointer">
                            Imprimir
                        </button>
                        <button onClick={onClose}
                            className="flex-1 bg-gray-100 hover:bg-gray-200 text-slate-800 p-3 rounded-lg font-bold cursor-pointer">
                            {textoCerrar}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
