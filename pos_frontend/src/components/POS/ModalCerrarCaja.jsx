import React, { useState, useEffect } from 'react';
import { posService } from '../../services/api';
import { X, DollarSign, CreditCard, ArrowRightLeft, TrendingUp, TrendingDown, CheckCircle, AlertTriangle } from 'lucide-react';

export default function ModalCerrarCaja({ onCajaCerrada, onClose }) {
    const [estadoCaja, setEstadoCaja] = useState(null);
    const [montoCierreReal, setMontoCierreReal] = useState('');
    const [loading, setLoading] = useState(false);
    const [loadingEstado, setLoadingEstado] = useState(true);
    const [reporte, setReporte] = useState(null);

    useEffect(() => {
        const cargarEstado = async () => {
            try {
                const estado = await posService.estadoCaja();
                setEstadoCaja(estado);
            } catch (error) {
                console.error("Error al consultar estado de caja:", error);
            } finally {
                setLoadingEstado(false);
            }
        };
        cargarEstado();
    }, []);

    const handleCerrarCaja = async (e) => {
        e.preventDefault();
        const monto = parseInt(montoCierreReal);
        if (isNaN(monto) || monto < 0) {
            alert("Ingresa un monto válido.");
            return;
        }

        if (!window.confirm("¿Estás seguro de cerrar la caja? Esta acción no se puede deshacer.")) {
            return;
        }

        setLoading(true);
        try {
            const resultado = await posService.cerrarCaja({ monto_cierre_real: monto });
            setReporte(resultado);
        } catch (error) {
            console.error("Error al cerrar caja:", error.response?.data);
            alert(error.response?.data?.error || "Hubo un error al cerrar la caja.");
        } finally {
            setLoading(false);
        }
    };

    const handleFinalizar = () => {
        if (onCajaCerrada) onCajaCerrada();
        onClose();
    };

    const formatCLP = (valor) => {
        return `$${Number(valor).toLocaleString('es-CL')}`;
    };

    // Pantalla de carga
    if (loadingEstado) {
        return (
            <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50">
                <div className="bg-white rounded-xl p-8 w-full max-w-md shadow-2xl text-center">
                    <p className="text-slate-500 animate-pulse">Consultando estado de caja...</p>
                </div>
            </div>
        );
    }

    // No hay caja abierta
    if (!estadoCaja?.abierta) {
        return (
            <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50">
                <div className="bg-white rounded-xl p-8 w-full max-w-md shadow-2xl text-center">
                    <AlertTriangle className="w-12 h-12 text-amber-500 mx-auto mb-4" />
                    <h2 className="text-xl font-bold text-slate-800 mb-2">Sin caja abierta</h2>
                    <p className="text-slate-500 mb-6">No hay una sesión de caja activa para cerrar.</p>
                    <button onClick={onClose} className="bg-slate-900 text-white px-6 py-2 rounded-lg font-semibold cursor-pointer">
                        Entendido
                    </button>
                </div>
            </div>
        );
    }

    // Reporte Z (después del cierre exitoso)
    if (reporte) {
        const { diferencia, resumen_ventas } = reporte;
        const esSobrante = diferencia > 0;
        const esFaltante = diferencia < 0;
        const esCuadrado = diferencia === 0;

        return (
            <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50">
                <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden">
                    {/* Header del reporte */}
                    <div className="bg-slate-900 text-white p-6">
                        <div className="flex items-center gap-3">
                            <CheckCircle className="w-8 h-8 text-emerald-400" />
                            <div>
                                <h2 className="text-xl font-bold">Reporte Z — Cierre de Caja</h2>
                                <p className="text-slate-400 text-sm">Sesión #{reporte.sesion_id} · {reporte.cajero}</p>
                            </div>
                        </div>
                    </div>

                    <div className="p-6 space-y-5">
                        {/* Cuadre de caja */}
                        <div className={`p-4 rounded-xl border-2 ${
                            esCuadrado ? 'bg-emerald-50 border-emerald-300' :
                            esSobrante ? 'bg-blue-50 border-blue-300' :
                            'bg-red-50 border-red-300'
                        }`}>
                            <div className="flex items-center justify-between">
                                <div>
                                    <p className="text-sm font-medium text-slate-600">Diferencia</p>
                                    <p className={`text-2xl font-black ${
                                        esCuadrado ? 'text-emerald-600' :
                                        esSobrante ? 'text-blue-600' :
                                        'text-red-600'
                                    }`}>
                                        {esSobrante && '+'}{formatCLP(diferencia)}
                                    </p>
                                </div>
                                <div className="text-right">
                                    {esCuadrado && <span className="text-emerald-600 font-bold text-sm">✓ CUADRADO</span>}
                                    {esSobrante && <TrendingUp className="w-8 h-8 text-blue-500" />}
                                    {esFaltante && <TrendingDown className="w-8 h-8 text-red-500" />}
                                </div>
                            </div>
                            <div className="flex justify-between mt-3 text-sm text-slate-600">
                                <span>Esperado: {formatCLP(reporte.monto_cierre_esperado)}</span>
                                <span>Contado: {formatCLP(reporte.monto_cierre_real)}</span>
                            </div>
                        </div>

                        {/* Desglose por método */}
                        <div>
                            <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wider mb-3">Desglose de Ventas</h3>
                            <div className="space-y-2">
                                <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                                    <div className="flex items-center gap-2">
                                        <DollarSign className="w-5 h-5 text-emerald-600" />
                                        <span className="font-medium text-slate-700">Efectivo</span>
                                        <span className="text-xs text-slate-400">({resumen_ventas.efectivo.cantidad} ventas)</span>
                                    </div>
                                    <span className="font-bold text-slate-800">{formatCLP(resumen_ventas.efectivo.total)}</span>
                                </div>

                                <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                                    <div className="flex items-center gap-2">
                                        <CreditCard className="w-5 h-5 text-blue-600" />
                                        <span className="font-medium text-slate-700">Tarjeta TUU</span>
                                        <span className="text-xs text-slate-400">({resumen_ventas.tarjeta_tuu.cantidad} ventas)</span>
                                    </div>
                                    <span className="font-bold text-slate-800">{formatCLP(resumen_ventas.tarjeta_tuu.total)}</span>
                                </div>

                                <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                                    <div className="flex items-center gap-2">
                                        <ArrowRightLeft className="w-5 h-5 text-violet-600" />
                                        <span className="font-medium text-slate-700">Transferencia</span>
                                        <span className="text-xs text-slate-400">({resumen_ventas.transferencia.cantidad} ventas)</span>
                                    </div>
                                    <span className="font-bold text-slate-800">{formatCLP(resumen_ventas.transferencia.total)}</span>
                                </div>
                            </div>
                        </div>

                        {/* Totales */}
                        <div className="border-t pt-4 flex justify-between items-center">
                            <div>
                                <p className="text-sm text-slate-500">Total del turno</p>
                                <p className="text-2xl font-black text-slate-900">{formatCLP(resumen_ventas.total_general)}</p>
                            </div>
                            <div className="text-right">
                                <p className="text-sm text-slate-500">Transacciones</p>
                                <p className="text-2xl font-black text-slate-900">{resumen_ventas.cantidad_total}</p>
                            </div>
                        </div>

                        {/* Vueltos entregados */}
                        {resumen_ventas.efectivo.vueltos > 0 && (
                            <p className="text-xs text-slate-400 text-center">
                                Vueltos entregados en efectivo: {formatCLP(resumen_ventas.efectivo.vueltos)}
                            </p>
                        )}

                        <button
                            onClick={handleFinalizar}
                            className="w-full bg-slate-900 hover:bg-slate-800 text-white p-4 rounded-xl font-bold transition-colors cursor-pointer"
                        >
                            Cerrar Reporte
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    // Formulario de cierre
    return (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-xl p-6 w-full max-w-md shadow-2xl relative">
                <button
                    onClick={onClose}
                    className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 cursor-pointer"
                >
                    <X className="w-5 h-5" />
                </button>

                <h2 className="text-xl font-bold mb-1 text-slate-800">Cierre de Caja</h2>
                <p className="text-sm text-slate-500 mb-2">
                    Sesión de <strong>{estadoCaja.cajero}</strong> · Apertura: {formatCLP(estadoCaja.monto_apertura)}
                </p>
                <p className="text-xs text-slate-400 mb-6">
                    Abierta el {new Date(estadoCaja.fecha_apertura).toLocaleString('es-CL')}
                </p>

                <form onSubmit={handleCerrarCaja}>
                    <div className="mb-5">
                        <label className="block text-sm font-medium text-slate-700 mb-1">
                            Monto real contado en caja ($)
                        </label>
                        <input
                            type="number"
                            value={montoCierreReal}
                            onChange={(e) => setMontoCierreReal(e.target.value)}
                            placeholder="Cuenta el efectivo en caja e ingresa el monto"
                            className="w-full p-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-slate-900 outline-none text-lg"
                            autoFocus
                            required
                            min="0"
                        />
                        <p className="text-xs text-slate-400 mt-1">
                            Solo efectivo. Tarjetas y transferencias se cuadran aparte.
                        </p>
                    </div>

                    <button
                        type="submit"
                        disabled={loading}
                        className="w-full bg-red-600 hover:bg-red-700 text-white p-3 rounded-lg font-semibold transition-colors disabled:opacity-50 cursor-pointer"
                    >
                        {loading ? "Cerrando caja..." : "Cerrar Caja y Generar Reporte Z"}
                    </button>
                </form>
            </div>
        </div>
    );
}
