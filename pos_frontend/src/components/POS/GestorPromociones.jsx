import React, { useState, useEffect } from 'react';
import { posService } from '../../services/api';
import { Tag, Save, Trash2 } from 'lucide-react';

export default function GestorPromociones() {
    const [promociones, setPromociones] = useState([]);
    const [cargando, setCargando] = useState(false);
    
    const [formulario, setFormulario] = useState({
        nombre: '',
        alcance_tipo: 'SKU',
        alcance_valor: '',
        tipo_promocion: 'VOLUMEN',
        cantidad_requerida: '',
        precio_promocional: '',
        cantidad_pagada: '',
        activa: true
    });

    useEffect(() => { cargarPromociones(); }, []);

    const cargarPromociones = async () => {
        try {
            const data = await posService.obtenerTodasPromociones();
            setPromociones(data);
        } catch (error) {
            console.error("Error al cargar promociones", error);
        }
    };

    const handleChange = (e) => {
        const { name, value, type, checked } = e.target;
        setFormulario(prev => ({
            ...prev, [name]: type === 'checkbox' ? checked : value
        }));
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setCargando(true);
        try {
            const payload = { ...formulario };
            if (payload.tipo_promocion === 'N_X_M') payload.precio_promocional = null;
            if (payload.tipo_promocion !== 'N_X_M') payload.cantidad_pagada = null;

            await posService.crearPromocion(payload);
            alert("¡Promoción creada con éxito!");
            setFormulario({
                nombre: '', alcance_tipo: 'SKU', alcance_valor: '', tipo_promocion: 'VOLUMEN', 
                cantidad_requerida: '', precio_promocional: '', cantidad_pagada: '', activa: true
            });
            cargarPromociones();
        } catch (error) {
            alert("Hubo un error al crear la promoción.");
        } finally {
            setCargando(false);
        }
    };

    const handleEliminar = async (id) => {
        if (window.confirm("¿Estás seguro de que deseas eliminar esta promoción? Esta acción no se puede deshacer.")) {
            try {
                await posService.eliminarPromocion(id);
                cargarPromociones(); // Recarga la tabla automáticamente
            } catch (error) {
                console.error("Error al eliminar:", error);
                alert("Hubo un error al intentar eliminar la promoción.");
            }
        }
    };

    return (
        <div className="p-6 bg-gray-50 min-h-screen">
            <div className="max-w-6xl mx-auto space-y-6">
                
                {/* FORMULARIO DE CREACIÓN */}
                <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                    <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2 mb-6">
                        <Tag className="w-6 h-6 text-emerald-600" />
                        Crear Nueva Promoción (Mix & Match)
                    </h2>
                    
                    <form onSubmit={handleSubmit} className="space-y-6">
                        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                            
                            <div className="col-span-2">
                                <label className="block text-sm font-medium text-slate-700 mb-2">Nombre de la Oferta</label>
                                <input required type="text" name="nombre" value={formulario.nombre} onChange={handleChange} placeholder="Ej: 3 Latas Motta por $10.000" className="w-full p-3 border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-emerald-500" />
                            </div>
                            
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-2">Aplica a:</label>
                                <select name="alcance_tipo" value={formulario.alcance_tipo} onChange={handleChange} className="w-full p-3 border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-emerald-500 bg-white">
                                    <option value="SKU">Un SKU Específico</option>
                                    <option value="PROVEEDOR">Proveedor (Marca)</option>
                                    <option value="TIPO">Tipo de Producto</option>
                                </select>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-2">Valor (Qué buscar):</label>
                                <input required type="text" name="alcance_valor" value={formulario.alcance_valor} onChange={handleChange} placeholder="Ej: Motta o lata-negra" className="w-full p-3 border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-emerald-500 font-mono text-sm" />
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-2">Regla de Oferta</label>
                                <select name="tipo_promocion" value={formulario.tipo_promocion} onChange={handleChange} className="w-full p-3 border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-emerald-500 bg-white">
                                    <option value="VOLUMEN">Precio por Volumen (Ej: 3 x $10.000)</option>
                                    <option value="N_X_M">Llevas N, Pagas M (Ej: 3x2)</option>
                                    <option value="POR_MAYOR">Precio Rebajado (Desde X unidades)</option>
                                </select>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-2">Unidades Requeridas</label>
                                <input required type="number" name="cantidad_requerida" value={formulario.cantidad_requerida} onChange={handleChange} placeholder="Ej: 3" min="1" className="w-full p-3 border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-emerald-500" />
                            </div>

                            {formulario.tipo_promocion === 'N_X_M' ? (
                                <div className="col-span-2">
                                    <label className="block text-sm font-medium text-slate-700 mb-2">Cantidad a Pagar (Para 3x2, escribe 2)</label>
                                    <input required type="number" name="cantidad_pagada" value={formulario.cantidad_pagada} onChange={handleChange} placeholder="Ej: 2" min="1" className="w-full p-3 border border-emerald-300 bg-emerald-50 rounded-lg outline-none focus:ring-2 focus:ring-emerald-500" />
                                </div>
                            ) : (
                                <div className="col-span-2">
                                    <label className="block text-sm font-medium text-slate-700 mb-2">Precio Total de la Promo ($)</label>
                                    <input required type="number" name="precio_promocional" value={formulario.precio_promocional} onChange={handleChange} placeholder="Ej: 10000" min="0" className="w-full p-3 border border-emerald-300 bg-emerald-50 rounded-lg outline-none focus:ring-2 focus:ring-emerald-500" />
                                </div>
                            )}
                        </div>

                        <div className="flex justify-end pt-4 border-t border-slate-100">
                            <button disabled={cargando} type="submit" className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-6 py-3 rounded-lg font-bold transition-colors shadow-md">
                                <Save className="w-5 h-5" /> Guardar Promoción
                            </button>
                        </div>
                    </form>
                </div>

                {/* TABLA DE PROMOCIONES ACTIVAS */}
                <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                    <table className="w-full text-left">
                        <thead className="bg-slate-50 border-b border-gray-200 text-slate-500 text-sm">
                            <tr>
                                <th className="p-4 font-medium">Oferta</th>
                                <th className="p-4 font-medium">Alcance</th>
                                <th className="p-4 font-medium">Valor Aplicado</th>
                                <th className="p-4 font-medium">Regla</th>
                                <th className="p-4 font-medium text-center">Acciones</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 text-sm">
                            {promociones.map(promo => (
                                <tr key={promo.id} className="hover:bg-slate-50">
                                    <td className="p-4 font-bold text-slate-800">{promo.nombre}</td>
                                    <td className="p-4 text-slate-600"><span className="bg-slate-100 px-2 py-1 rounded text-xs font-bold">{promo.alcance_tipo}</span></td>
                                    <td className="p-4 font-mono text-xs text-slate-500">{promo.alcance_valor}</td>
                                    <td className="p-4 text-slate-600">Llevando {promo.cantidad_requerida}</td>
                                    <td className="p-4 text-center">
                                        <button 
                                            onClick={() => handleEliminar(promo.id)}
                                            className="p-2 text-red-500 hover:text-red-700 hover:bg-red-50 rounded-lg transition-colors cursor-pointer"
                                            title="Eliminar Promoción"
                                        >
                                            <Trash2 className="w-5 h-5 mx-auto" />
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}