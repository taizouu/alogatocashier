import React, { useState, useEffect } from 'react';
import { comprasService } from '../../services/api';

export default function RegistroFacturas() {
    const [facturas, setFacturas] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        cargarHistorial();
    }, []);

    const cargarHistorial = async () => {
        try {
            const data = await comprasService.obtenerFacturas();
            setFacturas(data);
        } catch (error) {
            console.error("Error al cargar el historial:", error);
        } finally {
            setLoading(false);
        }
    };

    // Función auxiliar para sumar el total de una factura
    const calcularTotal = (detalles) => {
        return detalles.reduce((total, item) => total + (Number(item.costo_unitario) * Number(item.cantidad)), 0);
    };

    return (
        <div className="p-6 bg-gray-50 min-h-screen">
            <div className="bg-white rounded-lg p-8 w-full max-w-6xl mx-auto shadow-xl border border-gray-100">
                <div className="flex justify-between items-center mb-6">
                    <h2 className="text-2xl font-bold text-gray-800">Historial de Ingresos</h2>
                    <button onClick={cargarHistorial} className="text-blue-600 hover:bg-blue-50 px-4 py-2 rounded-lg font-medium transition-colors">
                        ↻ Actualizar
                    </button>
                </div>

                {loading ? (
                    <div className="text-center py-10 text-gray-500">Cargando registros...</div>
                ) : (
                    <div className="overflow-x-auto border border-gray-200 rounded-lg">
                        <table className="w-full text-left border-collapse">
                            <thead className="bg-gray-50 border-b border-gray-200">
                                <tr>
                                    <th className="p-4 text-sm font-semibold text-gray-600">Folio</th>
                                    <th className="p-4 text-sm font-semibold text-gray-600">Fecha Emisión</th>
                                    <th className="p-4 text-sm font-semibold text-gray-600">Proveedor (ID)</th>
                                    <th className="p-4 text-sm font-semibold text-gray-600 text-center">Ítems Distintos</th>
                                    <th className="p-4 text-sm font-semibold text-gray-600 text-right">Total Neto</th>
                                    <th className="p-4 text-sm font-semibold text-gray-600 text-center">Estado Shopify</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                                {facturas.length === 0 ? (
                                    <tr>
                                        <td colSpan="6" className="p-8 text-center text-gray-500">No hay facturas registradas.</td>
                                    </tr>
                                ) : (
                                    facturas.map((factura) => (
                                        <tr key={factura.id} className="hover:bg-gray-50 transition-colors">
                                            <td className="p-4 font-bold text-gray-800">#{factura.folio}</td>
                                            <td className="p-4 text-gray-600">{factura.fecha_emision}</td>
                                            <td className="p-4 text-gray-600">{factura.proveedor}</td>
                                            <td className="p-4 text-center text-gray-600">{factura.detalles?.length || 0}</td>
                                            <td className="p-4 text-right font-semibold text-blue-600">
                                                ${calcularTotal(factura.detalles || []).toLocaleString('es-CL')}
                                            </td>
                                            <td className="p-4 text-center">
                                                {factura.sincronizado_shopify ? (
                                                    <span className="bg-green-100 text-green-700 px-3 py-1 rounded-full text-xs font-bold">Sincronizado</span>
                                                ) : (
                                                    <span className="bg-yellow-100 text-yellow-700 px-3 py-1 rounded-full text-xs font-bold">Pendiente</span>
                                                )}
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
}