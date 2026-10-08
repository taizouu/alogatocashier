import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Lock, User, AlertCircle, LogIn } from 'lucide-react';
import { authService } from '../services/api';

export default function Login() {
    const [credenciales, setCredenciales] = useState({ username: '', password: '' });
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const navigate = useNavigate();

    const handleChange = (e) => {
        const { name, value } = e.target;
        setCredenciales(prev => ({ ...prev, [name]: value }));
        setError('');
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);
        try {
            await authService.login(credenciales.username, credenciales.password);
            navigate('/', { replace: true });
        } catch (err) {
            console.error(err);
            setError('Usuario o contrasena incorrectos. Por favor, intente nuevamente.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center bg-gray-100 font-sans">
            <div className="max-w-4xl w-full flex bg-white rounded-2xl shadow-2xl overflow-hidden">

                {/* Panel Izquierdo - Branding (Gris Oscuro Elegante) */}
                <div className="hidden md:flex w-1/2 bg-slate-900 text-white flex-col justify-between p-12 relative overflow-hidden">
                    <div className="relative z-10">
                        <img
                            src="/logo.png"
                            alt="AloGato GraffStore"
                            className="h-16 w-auto object-contain bg-white rounded-lg p-2 mb-8"
                            onError={(e) => { e.target.style.display = 'none'; }}
                        />
                        <h1 className="text-4xl font-black mb-4">AloGato GraffStore</h1>
                        <p className="text-slate-400 text-lg">Sistema de Gestion y Punto de Venta Profesional.</p>
                    </div>

                    <div className="relative z-10">
                        <p className="text-sm text-slate-500">&copy; 2026 AloGato POS. Todos los derechos reservados.</p>
                    </div>

                    <div className="absolute top-0 right-0 -mr-20 -mt-20 w-64 h-64 rounded-full bg-slate-800 opacity-50 blur-3xl"></div>
                    <div className="absolute bottom-0 left-0 -ml-20 -mb-20 w-80 h-80 rounded-full bg-slate-800 opacity-50 blur-3xl"></div>
                </div>

                {/* Panel Derecho - Formulario de Login */}
                <div className="w-full md:w-1/2 p-8 md:p-12 flex flex-col justify-center">
                    <div className="text-center mb-8">
                        <h2 className="text-2xl font-bold text-slate-800">Bienvenido al Terminal</h2>
                        <p className="text-slate-500 mt-2">Ingrese sus credenciales operativas</p>
                    </div>

                    {error && (
                        <div className="mb-6 p-4 bg-red-50 border-l-4 border-red-500 rounded flex items-center gap-3 text-red-700 text-sm">
                            <AlertCircle className="w-5 h-5 flex-shrink-0" />
                            <p>{error}</p>
                        </div>
                    )}

                    <form onSubmit={handleSubmit} className="space-y-6">
                        <div>
                            <label className="block text-sm font-semibold text-slate-700 mb-2">Usuario</label>
                            <div className="relative">
                                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                    <User className="h-5 w-5 text-slate-400" />
                                </div>
                                <input
                                    type="text"
                                    name="username"
                                    value={credenciales.username}
                                    onChange={handleChange}
                                    className="block w-full pl-10 pr-3 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-slate-900 focus:border-slate-900 sm:text-sm transition-colors outline-none"
                                    placeholder="Ej: cajero_turno1"
                                    required
                                />
                            </div>
                        </div>

                        <div>
                            <label className="block text-sm font-semibold text-slate-700 mb-2">Contrasena</label>
                            <div className="relative">
                                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                    <Lock className="h-5 w-5 text-slate-400" />
                                </div>
                                <input
                                    type="password"
                                    name="password"
                                    value={credenciales.password}
                                    onChange={handleChange}
                                    className="block w-full pl-10 pr-3 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-slate-900 focus:border-slate-900 sm:text-sm transition-colors outline-none"
                                    placeholder="••••••••"
                                    required
                                />
                            </div>
                        </div>

                        <button
                            type="submit"
                            disabled={loading}
                            className="w-full flex justify-center items-center gap-2 bg-slate-900 text-white py-3 px-4 rounded-lg font-bold hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-slate-900 transition-colors disabled:opacity-70 disabled:cursor-not-allowed cursor-pointer"
                        >
                            {loading ? (
                                'Verificando credenciales...'
                            ) : (
                                <>
                                    <LogIn className="w-5 h-5" />
                                    Acceder al POS
                                </>
                            )}
                        </button>
                    </form>
                </div>
            </div>
        </div>
    );
}
