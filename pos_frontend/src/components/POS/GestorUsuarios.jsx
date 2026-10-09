import React, { useState, useEffect } from 'react';
import { usuariosService } from '../../services/api';
import { Users, Save, UserPlus, Shield, ShieldOff, Eye, EyeOff } from 'lucide-react';

export default function GestorUsuarios() {
    const [usuarios, setUsuarios] = useState([]);
    const [cargando, setCargando] = useState(false);
    const [mostrarPassword, setMostrarPassword] = useState(false);
    const [editando, setEditando] = useState(null); // ID del usuario en edición

    const formularioVacio = {
        username: '',
        first_name: '',
        last_name: '',
        password: '',
        rol: 'VENDEDOR',
    };
    const [formulario, setFormulario] = useState(formularioVacio);

    useEffect(() => { cargarUsuarios(); }, []);

    const cargarUsuarios = async () => {
        try {
            const data = await usuariosService.obtenerUsuarios();
            setUsuarios(data);
        } catch (error) {
            console.error("Error al cargar usuarios", error);
        }
    };

    const handleChange = (e) => {
        const { name, value } = e.target;
        setFormulario(prev => ({ ...prev, [name]: value }));
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setCargando(true);
        try {
            if (editando) {
                // Actualizar usuario existente
                const payload = { ...formulario };
                // Si no se escribió contraseña nueva, no la enviamos
                if (!payload.password) delete payload.password;
                await usuariosService.actualizarUsuario(editando, payload);
                alert("Usuario actualizado con éxito.");
            } else {
                // Crear nuevo usuario
                if (!formulario.password) {
                    alert("Debes ingresar una contraseña para el nuevo usuario.");
                    setCargando(false);
                    return;
                }
                await usuariosService.crearUsuario(formulario);
                alert("Usuario creado con éxito.");
            }
            setFormulario(formularioVacio);
            setEditando(null);
            setMostrarPassword(false);
            cargarUsuarios();
        } catch (error) {
            const detalle = error.response?.data;
            if (detalle?.username) {
                alert(`Error: ${detalle.username[0]}`);
            } else {
                alert("Hubo un error al guardar el usuario.");
            }
        } finally {
            setCargando(false);
        }
    };

    const handleEditar = (usuario) => {
        setEditando(usuario.id);
        setFormulario({
            username: usuario.username,
            first_name: usuario.first_name || '',
            last_name: usuario.last_name || '',
            password: '',
            rol: usuario.rol,
        });
        setMostrarPassword(false);
        // Scroll al formulario
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const handleCancelar = () => {
        setEditando(null);
        setFormulario(formularioVacio);
        setMostrarPassword(false);
    };

    const handleToggleActivo = async (usuario) => {
        const accion = usuario.is_active ? 'desactivar' : 'activar';
        if (!window.confirm(`¿Estás seguro de que deseas ${accion} al usuario "${usuario.username}"?`)) return;

        try {
            await usuariosService.actualizarUsuario(usuario.id, {
                is_active: !usuario.is_active,
            });
            cargarUsuarios();
        } catch (error) {
            alert(`Error al ${accion} el usuario.`);
        }
    };

    return (
        <div className="p-6 bg-gray-50 min-h-screen">
            <div className="max-w-5xl mx-auto space-y-6">

                {/* FORMULARIO */}
                <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                    <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2 mb-6">
                        <UserPlus className="w-6 h-6 text-blue-600" />
                        {editando ? 'Editar Usuario' : 'Crear Nuevo Usuario'}
                    </h2>

                    <form onSubmit={handleSubmit} className="space-y-6">
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">

                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-2">Nombre de Usuario</label>
                                <input
                                    required type="text" name="username"
                                    value={formulario.username} onChange={handleChange}
                                    placeholder="Ej: vendedor1"
                                    disabled={!!editando}
                                    className="w-full p-3 border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-500"
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-2">Nombre</label>
                                <input
                                    type="text" name="first_name"
                                    value={formulario.first_name} onChange={handleChange}
                                    placeholder="Ej: Juan"
                                    className="w-full p-3 border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500"
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-2">Apellido</label>
                                <input
                                    type="text" name="last_name"
                                    value={formulario.last_name} onChange={handleChange}
                                    placeholder="Ej: Pérez"
                                    className="w-full p-3 border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500"
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-2">
                                    {editando ? 'Nueva Contraseña (dejar vacío para mantener)' : 'Contraseña'}
                                </label>
                                <div className="relative">
                                    <input
                                        type={mostrarPassword ? 'text' : 'password'}
                                        name="password"
                                        value={formulario.password} onChange={handleChange}
                                        placeholder={editando ? 'Sin cambios' : 'Mín. 6 caracteres'}
                                        required={!editando}
                                        minLength={formulario.password ? 6 : undefined}
                                        className="w-full p-3 pr-12 border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setMostrarPassword(!mostrarPassword)}
                                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
                                    >
                                        {mostrarPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                                    </button>
                                </div>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-2">Rol</label>
                                <select
                                    name="rol" value={formulario.rol} onChange={handleChange}
                                    className="w-full p-3 border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                                >
                                    <option value="VENDEDOR">Vendedor</option>
                                    <option value="ADMIN">Administrador</option>
                                </select>
                            </div>
                        </div>

                        <div className="flex justify-end gap-3 pt-4 border-t border-slate-100">
                            {editando && (
                                <button
                                    type="button" onClick={handleCancelar}
                                    className="px-6 py-3 rounded-lg font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 transition-colors cursor-pointer"
                                >
                                    Cancelar
                                </button>
                            )}
                            <button
                                disabled={cargando} type="submit"
                                className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-lg font-bold transition-colors shadow-md cursor-pointer"
                            >
                                <Save className="w-5 h-5" />
                                {editando ? 'Guardar Cambios' : 'Crear Usuario'}
                            </button>
                        </div>
                    </form>
                </div>

                {/* TABLA DE USUARIOS */}
                <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                    <div className="p-4 border-b border-gray-200 bg-slate-50">
                        <h3 className="font-bold text-slate-700 flex items-center gap-2">
                            <Users className="w-5 h-5 text-slate-500" />
                            Usuarios Registrados ({usuarios.length})
                        </h3>
                    </div>
                    <table className="w-full text-left">
                        <thead className="bg-slate-50 border-b border-gray-200 text-slate-500 text-sm">
                            <tr>
                                <th className="p-4 font-medium">Usuario</th>
                                <th className="p-4 font-medium">Nombre Completo</th>
                                <th className="p-4 font-medium text-center">Rol</th>
                                <th className="p-4 font-medium text-center">Estado</th>
                                <th className="p-4 font-medium text-center">Acciones</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 text-sm">
                            {usuarios.map(user => (
                                <tr key={user.id} className={`hover:bg-slate-50 ${!user.is_active ? 'opacity-50' : ''}`}>
                                    <td className="p-4 font-bold text-slate-800">{user.username}</td>
                                    <td className="p-4 text-slate-600">
                                        {user.first_name || user.last_name
                                            ? `${user.first_name} ${user.last_name}`.trim()
                                            : <span className="text-slate-400 italic">Sin nombre</span>
                                        }
                                    </td>
                                    <td className="p-4 text-center">
                                        <span className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-bold ${
                                            user.rol === 'ADMIN'
                                                ? 'bg-amber-100 text-amber-800'
                                                : 'bg-blue-100 text-blue-800'
                                        }`}>
                                            {user.rol === 'ADMIN' ? <Shield className="w-3 h-3" /> : <ShieldOff className="w-3 h-3" />}
                                            {user.rol === 'ADMIN' ? 'Admin' : 'Vendedor'}
                                        </span>
                                    </td>
                                    <td className="p-4 text-center">
                                        <span className={`px-3 py-1 rounded-full text-xs font-bold ${
                                            user.is_active
                                                ? 'bg-green-100 text-green-800'
                                                : 'bg-red-100 text-red-800'
                                        }`}>
                                            {user.is_active ? 'Activo' : 'Inactivo'}
                                        </span>
                                    </td>
                                    <td className="p-4 text-center">
                                        <div className="flex items-center justify-center gap-2">
                                            <button
                                                onClick={() => handleEditar(user)}
                                                className="px-3 py-1.5 text-blue-600 bg-blue-50 border border-blue-200 hover:bg-blue-100 rounded-lg text-xs font-bold transition-colors cursor-pointer"
                                            >
                                                Editar
                                            </button>
                                            <button
                                                onClick={() => handleToggleActivo(user)}
                                                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                                                    user.is_active
                                                        ? 'text-red-600 bg-red-50 border border-red-200 hover:bg-red-100'
                                                        : 'text-green-600 bg-green-50 border border-green-200 hover:bg-green-100'
                                                }`}
                                            >
                                                {user.is_active ? 'Desactivar' : 'Activar'}
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                            {usuarios.length === 0 && (
                                <tr>
                                    <td colSpan="5" className="p-8 text-center text-slate-400">
                                        No hay usuarios registrados.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}
