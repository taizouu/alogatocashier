import React from 'react';
import { NavLink } from 'react-router-dom';
import { authService } from '../../services/api';

export default function Navbar({ onLogout }) {
    const isAdmin = authService.isAdmin();
    const username = authService.getUsername();

    const linkBase = "px-4 py-2 rounded-lg font-medium transition-colors flex items-center gap-2";

    const getLinkClass = (color) => ({ isActive }) => {
        if (color === 'gray') {
            return `${linkBase} ${isActive ? 'bg-gray-200 text-gray-800' : 'hover:bg-gray-100 text-gray-600'}`;
        }
        if (color === 'blue') {
            return `${linkBase} ${isActive ? 'bg-blue-600 text-white' : 'hover:bg-blue-50 text-blue-600'}`;
        }
        if (color === 'purple') {
            return `${linkBase} ml-4 ${isActive ? 'bg-purple-600 text-white shadow-md' : 'border border-purple-300 text-purple-700 hover:bg-purple-50'}`;
        }
        if (color === 'emerald') {
            return `${linkBase} ml-2 ${isActive ? 'bg-emerald-600 text-white shadow-md' : 'border border-emerald-300 text-emerald-700 hover:bg-emerald-50'}`;
        }
        if (color === 'amber') {
            return `${linkBase} ml-2 ${isActive ? 'bg-amber-600 text-white shadow-md' : 'border border-amber-300 text-amber-700 hover:bg-amber-50'}`;
        }
    };

    return (
        <nav className="flex items-center justify-between p-4 bg-white shadow-sm border-b border-gray-200">

            {/* Controles de Navegacion Izquierdos */}
            <div className="flex items-center gap-4">
                <h1 className="text-xl font-black text-blue-900 mr-4">Punto de Venta</h1>

                <NavLink to="/" end className={getLinkClass('gray')}>
                    Caja POS
                </NavLink>

                {/* BOTONES RESTRINGIDOS: Solo se renderizan si el usuario es ADMIN */}
                {isAdmin && (
                    <>
                        <NavLink to="/compras" className={getLinkClass('blue')}>
                            Ingresar Factura
                        </NavLink>

                        <NavLink
                            to="/historial"
                            className={getLinkClass('purple')}
                            title="Solo visible para Administradores"
                        >
                            Historial Facturas
                        </NavLink>

                        <NavLink to="/promociones" className={getLinkClass('emerald')}>
                            Promociones
                        </NavLink>

                        <NavLink to="/usuarios" className={getLinkClass('amber')}>
                            Usuarios
                        </NavLink>
                    </>
                )}
            </div>

            {/* Controles Derechos */}
            <div className="flex items-center gap-4">
                <span className="text-sm text-gray-500">
                    {username} <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 ml-1">{isAdmin ? 'Admin' : 'Vendedor'}</span>
                </span>
                <button
                    onClick={onLogout}
                    className="px-6 py-2 text-red-600 bg-red-50 border border-red-200 hover:bg-red-100 hover:border-red-300 rounded-lg font-medium transition-colors cursor-pointer"
                >
                    Cerrar Sesion
                </button>
            </div>
        </nav>
    );
}
