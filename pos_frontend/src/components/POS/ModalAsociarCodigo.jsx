import React, { useState, useEffect, useRef } from 'react';
import { posService, comprasService } from '../../services/api';

/**
 * Modal que aparece cuando la pistola lee un código que no existe en Shopify.
 * Permite buscar el producto por nombre y asignarle ese código de barras.
 *
 * Props:
 *  - codigo: el código de barras leído
 *  - onAsociado(producto): se llama con el producto ya actualizado
 *  - onClose(): cerrar sin asociar
 */
export default function ModalAsociarCodigo({ codigo, onAsociado, onClose }) {
    const [texto, setTexto] = useState('');
    const [resultados, setResultados] = useState([]);
    const [buscando, setBuscando] = useState(false);
    const [guardando, setGuardando] = useState(false);
    const [error, setError] = useState('');
    // Variante elegida que ya tiene otro código: esperamos confirmación
    const [pendienteReemplazo, setPendienteReemplazo] = useState(null);
    const debounceRef = useRef(null);
    const inputRef = useRef(null);

    useEffect(() => {
        inputRef.current?.focus();
        const onKey = (e) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', onKey);
        return () => {
            window.removeEventListener('keydown', onKey);
            clearTimeout(debounceRef.current);
        };
    }, [onClose]);

    const handleBuscar = (valor) => {
        setTexto(valor);
        setError('');
        setPendienteReemplazo(null);
        clearTimeout(debounceRef.current);

        if (valor.trim().length < 2) {
            setResultados([]);
            return;
        }
        debounceRef.current = setTimeout(async () => {
            setBuscando(true);
            try {
                const data = await posService.buscarProductoPorNombre(valor.trim());
                setResultados(data || []);
            } catch {
                setResultados([]);
                setError('No se pudo buscar en Shopify.');
            } finally {
                setBuscando(false);
            }
        }, 300);
    };

    const asociar = async (producto, reemplazar = false) => {
        setGuardando(true);
        setError('');
        try {
            const actualizado = await comprasService.asociarCodigoBarras(
                producto.id_shopify, codigo, reemplazar
            );
            onAsociado(actualizado);
        } catch (err) {
            const data = err.response?.data || {};
            if (err.response?.status === 409 && data.conflicto === 'VARIANTE_CON_CODIGO') {
                setPendienteReemplazo({ producto, barcodeActual: data.barcode_actual });
            } else {
                setError(data.error || 'No se pudo asociar el código.');
            }
        } finally {
            setGuardando(false);
        }
    };

    const handleElegir = (producto) => {
        // Si ya sabemos que tiene otro código, pedimos confirmación sin ir al servidor
        if (producto.codigo_barras && producto.codigo_barras !== codigo) {
            setPendienteReemplazo({ producto, barcodeActual: producto.codigo_barras });
            return;
        }
        asociar(producto);
    };

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">

                <div className="p-6 border-b border-gray-200">
                    <h3 className="text-xl font-bold text-gray-800">Código no registrado</h3>
                    <p className="text-gray-600 mt-1">
                        El código <span className="font-mono font-bold bg-yellow-100 px-2 py-0.5 rounded">{codigo}</span> no
                        está en Shopify. Busca el producto para asignárselo.
                    </p>
                </div>

                <div className="p-6 flex-1 overflow-y-auto space-y-4">
                    <input
                        ref={inputRef}
                        type="text"
                        value={texto}
                        onChange={(e) => handleBuscar(e.target.value)}
                        placeholder="Nombre, marca, tipo o color del producto"
                        className="w-full p-3 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500"
                        disabled={guardando}
                    />

                    {error && (
                        <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">{error}</div>
                    )}

                    {pendienteReemplazo ? (
                        <div className="p-4 rounded-lg bg-amber-50 border border-amber-300 space-y-3">
                            <p className="text-amber-900">
                                <strong>{pendienteReemplazo.producto.nombre}</strong> ya tiene el código{' '}
                                <span className="font-mono font-bold">{pendienteReemplazo.barcodeActual}</span>.
                                ¿Quieres reemplazarlo por <span className="font-mono font-bold">{codigo}</span>?
                            </p>
                            <p className="text-sm text-amber-800">
                                El código anterior dejará de funcionar en la caja.
                            </p>
                            <div className="flex gap-3 justify-end">
                                <button
                                    onClick={() => setPendienteReemplazo(null)}
                                    disabled={guardando}
                                    className="px-4 py-2 rounded-lg bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 cursor-pointer"
                                >
                                    No, elegir otro
                                </button>
                                <button
                                    onClick={() => asociar(pendienteReemplazo.producto, true)}
                                    disabled={guardando}
                                    className="px-4 py-2 rounded-lg bg-amber-600 text-white font-bold hover:bg-amber-700 disabled:opacity-50 cursor-pointer"
                                >
                                    {guardando ? 'Guardando...' : 'Sí, reemplazar'}
                                </button>
                            </div>
                        </div>
                    ) : (
                        <ul className="divide-y divide-gray-100 border border-gray-200 rounded-lg">
                            {buscando && <li className="p-4 text-center text-gray-500">Buscando...</li>}
                            {!buscando && texto.trim().length >= 2 && resultados.length === 0 && (
                                <li className="p-4 text-center text-gray-500">Sin resultados.</li>
                            )}
                            {!buscando && texto.trim().length < 2 && (
                                <li className="p-4 text-center text-gray-400">Escribe al menos 2 letras para buscar.</li>
                            )}
                            {!buscando && resultados.map((prod) => (
                                <li key={prod.id_shopify} className="p-3 flex justify-between items-center gap-4 hover:bg-blue-50">
                                    <div className="min-w-0">
                                        <span className="font-medium text-gray-800 block truncate">{prod.nombre}</span>
                                        <span className="text-xs text-gray-500 font-mono">
                                            {prod.proveedor ? `${prod.proveedor} · ` : ''}SKU: {prod.sku || 'N/A'} · Código: {prod.codigo_barras || <em>sin código</em>}
                                        </span>
                                    </div>
                                    <button
                                        onClick={() => handleElegir(prod)}
                                        disabled={guardando}
                                        className="flex-shrink-0 px-3 py-1.5 rounded-lg text-sm font-bold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 cursor-pointer"
                                    >
                                        {guardando ? '...' : 'Asignar'}
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>

                <div className="p-4 border-t border-gray-200 flex justify-end">
                    <button
                        onClick={onClose}
                        disabled={guardando}
                        className="px-6 py-2 rounded-lg text-gray-700 bg-gray-100 hover:bg-gray-200 font-medium cursor-pointer"
                    >
                        Cancelar
                    </button>
                </div>
            </div>
        </div>
    );
}
