import React, { useState } from 'react';
import { comprasService } from '../../services/api';

export default function ModalNuevoProveedor({ onClose, onProveedorCreado }) {
    const [formData, setFormData] = useState({
        rut: '',
        razon_social: '',
        telefono: '',
        email: ''
    });
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);
        try {
            const nuevoProveedor = await comprasService.crearProveedor(formData);
            alert("Proveedor registrado con éxito");
            onProveedorCreado(nuevoProveedor); // Pasamos el nuevo objeto al componente padre
        } catch (error) {
            console.error(error);
            alert("Error al registrar el proveedor. Verifica los datos.");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-xl p-6 w-full max-w-md shadow-2xl">
                <h2 className="text-xl font-bold mb-4 text-gray-800">Nuevo Proveedor</h2>
                
                <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700">RUT</label>
                        <input
                            type="text"
                            required
                            placeholder="Ej: 76.123.456-K"
                            className="w-full p-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 outline-none"
                            onChange={e => setFormData({...formData, rut: e.target.value})}
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700">Razón Social</label>
                        <input
                            type="text"
                            required
                            placeholder="Nombre de la empresa"
                            className="w-full p-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 outline-none"
                            onChange={e => setFormData({...formData, razon_social: e.target.value})}
                        />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                        <div>
                            <label className="block text-sm font-medium text-gray-700">Teléfono</label>
                            <input
                                type="text"
                                className="w-full p-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 outline-none"
                                onChange={e => setFormData({...formData, telefono: e.target.value})}
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700">Email</label>
                            <input
                                type="email"
                                className="w-full p-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 outline-none"
                                onChange={e => setFormData({...formData, email: e.target.value})}
                            />
                        </div>
                    </div>

                    <div className="flex justify-end space-x-2 mt-6">
                        <button type="button" onClick={onClose} className="px-4 py-2 bg-gray-200 rounded hover:bg-gray-300 font-medium cursor-pointer">
                            Cancelar
                        </button>
                        <button type="submit" disabled={loading} className="px-6 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 font-medium cursor-pointer disabled:opacity-50">
                            {loading ? "Guardando..." : "Guardar Proveedor"}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}