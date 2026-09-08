import React, { useState } from 'react';
import { posService } from '../../services/api';

export default function ModalAbrirCaja({ onSesionAbierta }) {
    const [montoApertura, setMontoApertura] = useState('');
    const [loading, setLoading] = useState(false);

    const handleAbrirCaja = async (e) => {
        e.preventDefault();
        const monto = parseFloat(montoApertura);
        if (isNaN(monto) || monto < 0) {
            alert("Ingresa un monto de apertura válido.");
            return;
        }

        setLoading(true);
        try {
            await posService.abrirCaja({ monto_apertura: monto });
            alert("¡Caja abierta con éxito!");
            if (onSesionAbierta) onSesionAbierta();
        } catch (error) {
            console.error("Error al abrir caja:", error.response?.data);
            alert(error.response?.data?.error || "Hubo un error al abrir la caja.");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-xl p-6 w-full max-w-md shadow-2xl">
                <h2 className="text-xl font-bold mb-2 text-gray-800">Apertura de Caja</h2>
                <p className="text-sm text-gray-500 mb-6">Ingresa el monto inicial de efectivo en caja para comenzar el turno.</p>

                <form onSubmit={handleAbrirCaja}>
                    <div className="mb-4">
                        <label className="block text-sm font-medium text-gray-700 mb-1">Monto Inicial ($)</label>
                        <input
                            type="number"
                            value={montoApertura}
                            onChange={(e) => setMontoApertura(e.target.value)}
                            placeholder="Ej: 50000"
                            className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-lg"
                            autoFocus
                            required
                        />
                    </div>

                    <button
                        type="submit"
                        disabled={loading}
                        className="w-full bg-blue-600 hover:bg-blue-700 text-white p-3 rounded-lg font-semibold transition-colors disabled:opacity-50 cursor-pointer"
                    >
                        {loading ? "Abriendo caja..." : "Abrir Turno"}
                    </button>
                </form>
            </div>
        </div>
    );
}