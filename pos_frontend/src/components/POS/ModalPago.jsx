import React, { useState } from 'react';
import { posService } from '../../services/api';

export default function ModalPago({ carrito = [], totalCompra = 0, onClose, onVentaExitosa }) {
    const [metodoPago, setMetodoPago] = useState('EFECTIVO');
    const [montoRecibido, setMontoRecibido] = useState('');
    const [loading, setLoading] = useState(false);

    const totalSeguro = Number(totalCompra) || 0;
    const efectivo = parseFloat(montoRecibido) || 0;
    const vuelto = metodoPago === 'EFECTIVO' ? Math.max(0, efectivo - totalSeguro) : 0;

    // Función para sumar billetes de forma acumulativa
    const sumarEfectivo = (valor) => {
        const actual = parseFloat(montoRecibido) || 0;
        setMontoRecibido((actual + valor).toString());
    };

    const handlePagar = async () => {
        if (metodoPago === 'EFECTIVO' && efectivo < totalSeguro) {
            alert("El monto recibido es menor que el total de la compra.");
            return;
        }

        setLoading(true);
        try {
            const datosVenta = {
                total: totalSeguro,
                metodo_pago: metodoPago,
                monto_recibido: metodoPago === 'EFECTIVO' ? efectivo : null,
                vuelto: vuelto,
                detalles: (carrito || []).map(item => ({
                    id_shopify: item.id_shopify,
                    codigo_barras: item.codigo_barras || '',
                    sku: item.sku || '',
                    nombre_producto: item.nombre || '',
                    cantidad: item.cantidad,
                    precio_unitario: item.precio
                }))
            };

            await posService.procesarVenta(datosVenta);
            
            alert("¡Venta registrada con éxito y stock descontado en Shopify!");
            if (onVentaExitosa) onVentaExitosa();

        } catch (error) {
            console.error("Error al procesar la venta:", error.response?.data);
            alert("Hubo un error al registrar la venta en el servidor.");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-lg p-6 w-full max-w-lg shadow-xl">
                <h2 className="text-xl font-bold mb-4 text-gray-800">Seleccionar Medio de Pago</h2>
                
                <div className="text-lg font-semibold mb-4 text-gray-600 flex justify-between items-center bg-gray-50 p-3 rounded-lg border">
                    <span>Total a Pagar:</span>
                    <span className="text-green-600 font-bold text-2xl">${totalSeguro.toLocaleString('es-CL')}</span>
                </div>

                {/* Botones de selección de método */}
                <div className="grid grid-cols-3 gap-2 mb-4">
                    <button
                        type="button"
                        onClick={() => setMetodoPago('EFECTIVO')}
                        className={`p-3 rounded font-medium border transition-all cursor-pointer ${
                            metodoPago === 'EFECTIVO' 
                                ? 'bg-blue-600 text-white border-blue-600 shadow' 
                                : 'bg-gray-100 text-gray-700 border-gray-300 hover:bg-gray-200'
                        }`}
                    >
                        Efectivo
                    </button>
                    <button
                        type="button"
                        onClick={() => setMetodoPago('TARJETA_TUU')}
                        className={`p-3 rounded font-medium border transition-all cursor-pointer ${
                            metodoPago === 'TARJETA_TUU' 
                                ? 'bg-blue-600 text-white border-blue-600 shadow' 
                                : 'bg-gray-100 text-gray-700 border-gray-300 hover:bg-gray-200'
                        }`}
                    >
                        Tarjeta TUU
                    </button>
                    <button
                        type="button"
                        onClick={() => setMetodoPago('TRANSFERENCIA')}
                        className={`p-3 rounded font-medium border transition-all cursor-pointer ${
                            metodoPago === 'TRANSFERENCIA' 
                                ? 'bg-blue-600 text-white border-blue-600 shadow' 
                                : 'bg-gray-100 text-gray-700 border-gray-300 hover:bg-gray-200'
                        }`}
                    >
                        Transferencia
                    </button>
                </div>

                {/* Selección visual de billetes y monedas chilenas si es Efectivo */}
                {metodoPago === 'EFECTIVO' && (
                    <div className="mb-4 bg-gray-50 p-4 rounded-lg border border-gray-200">
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                            Selecciona los billetes / monedas recibidos:
                        </label>
                        
                        {/* Grid de Billetes Chilenos */}
                        <div className="grid grid-cols-3 gap-2 mb-3">
                            <button
                                type="button"
                                onClick={() => sumarEfectivo(1000)}
                                className="p-3 bg-green-100 border border-green-400 text-green-900 rounded-lg font-bold hover:bg-green-200 transition-all shadow-sm cursor-pointer flex flex-col items-center"
                            >
                                <span className="text-xs font-normal text-green-700">Billete</span>
                                $1.000
                            </button>
                            <button
                                type="button"
                                onClick={() => sumarEfectivo(2000)}
                                className="p-3 bg-purple-100 border border-purple-400 text-purple-900 rounded-lg font-bold hover:bg-purple-200 transition-all shadow-sm cursor-pointer flex flex-col items-center"
                            >
                                <span className="text-xs font-normal text-purple-700">Billete</span>
                                $2.000
                            </button>
                            <button
                                type="button"
                                onClick={() => sumarEfectivo(5000)}
                                className="p-3 bg-red-100 border border-red-400 text-red-900 rounded-lg font-bold hover:bg-red-200 transition-all shadow-sm cursor-pointer flex flex-col items-center"
                            >
                                <span className="text-xs font-normal text-red-700">Billete</span>
                                $5.000
                            </button>
                            <button
                                type="button"
                                onClick={() => sumarEfectivo(10000)}
                                className="p-3 bg-orange-100 border border-orange-400 text-orange-900 rounded-lg font-bold hover:bg-orange-200 transition-all shadow-sm cursor-pointer flex flex-col items-center"
                            >
                                <span className="text-xs font-normal text-orange-700">Billete</span>
                                $10.000
                            </button>
                            <button
                                type="button"
                                onClick={() => sumarEfectivo(20000)}
                                className="p-3 bg-blue-100 border border-blue-400 text-blue-900 rounded-lg font-bold hover:bg-blue-200 transition-all shadow-sm cursor-pointer flex flex-col items-center"
                            >
                                <span className="text-xs font-normal text-blue-700">Billete</span>
                                $20.000
                            </button>
                            <button
                                type="button"
                                onClick={() => setMontoRecibido(totalSeguro.toString())}
                                className="p-3 bg-emerald-600 text-white rounded-lg font-bold hover:bg-emerald-700 transition-all shadow-sm cursor-pointer flex flex-col items-center justify-center text-sm"
                            >
                                Exacto
                            </button>
                        </div>

                        {/* Input y resumen de recibido / vuelto */}
                        <div className="flex gap-2 items-center">
                            <div className="flex-1">
                                <label className="block text-xs font-medium text-gray-600 mb-1">Total Recibido ($)</label>
                                <input
                                    type="number"
                                    value={montoRecibido}
                                    onChange={(e) => setMontoRecibido(e.target.value)}
                                    placeholder="0"
                                    className="w-full p-2 border border-gray-300 rounded bg-white font-bold text-lg outline-none focus:ring-2 focus:ring-blue-500"
                                />
                            </div>
                            <button
                                type="button"
                                onClick={() => setMontoRecibido('')}
                                className="mt-5 px-3 py-2 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded text-sm font-medium transition-colors"
                            >
                                Limpiar
                            </button>
                        </div>

                        <div className="mt-3 flex justify-between items-center text-lg bg-white p-2 rounded border">
                            <span className="font-medium text-gray-700">Vuelto a entregar:</span>
                            <span className={`font-bold ${vuelto > 0 ? 'text-blue-600' : 'text-gray-500'}`}>
                                ${vuelto.toLocaleString('es-CL')}
                            </span>
                        </div>
                    </div>
                )}

                {/* Botones de acción */}
                <div className="flex justify-end space-x-2 mt-6">
                    <button
                        type="button"
                        onClick={onClose}
                        className="px-4 py-2 bg-gray-200 text-gray-700 rounded hover:bg-gray-300 font-medium transition-colors cursor-pointer"
                    >
                        Cancelar
                    </button>
                    <button
                        type="button"
                        onClick={handlePagar}
                        disabled={loading}
                        className="px-6 py-2 bg-green-600 text-white rounded hover:bg-green-700 font-medium transition-colors disabled:opacity-50 cursor-pointer"
                    >
                        {loading ? "Procesando..." : "Confirmar Venta"}
                    </button>
                </div>
            </div>
        </div>
    );
}