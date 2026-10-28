import React, { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { X } from 'lucide-react';

// Ícono ☰ dibujado aquí (no depende del nombre del ícono en la versión de lucide)
const IconoMenu = ({ className }) => (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
        <path d="M4 6h16M4 12h16M4 18h16" />
    </svg>
);
import { authService } from '../../services/api';

// Enlaces del menú. `admin`: solo se muestran a administradores.
const ENLACES = [
    { to: '/', nombre: 'Caja POS', color: 'gray', end: true },
    { to: '/ventas', nombre: 'Ventas', color: 'blue', admin: true },
    { to: '/documentos', nombre: 'Boletas y Facturas', color: 'blue', admin: true },
    { to: '/compras', nombre: 'Ingresar Factura', color: 'blue', admin: true },
    { to: '/historial', nombre: 'Historial Facturas', color: 'purple', admin: true },
    { to: '/promociones', nombre: 'Promociones', color: 'emerald', admin: true },
    { to: '/usuarios', nombre: 'Usuarios', color: 'amber', admin: true },
];

const COLORES = {
    gray: ['bg-gray-200 text-gray-800', 'hover:bg-gray-100 text-gray-600'],
    blue: ['bg-blue-600 text-white', 'hover:bg-blue-50 text-blue-600'],
    purple: ['bg-purple-600 text-white shadow-md', 'border border-purple-300 text-purple-700 hover:bg-purple-50'],
    emerald: ['bg-emerald-600 text-white shadow-md', 'border border-emerald-300 text-emerald-700 hover:bg-emerald-50'],
    amber: ['bg-amber-600 text-white shadow-md', 'border border-amber-300 text-amber-700 hover:bg-amber-50'],
};

const claseEnlace = (color) => ({ isActive }) =>
    `px-4 py-2 rounded-lg font-medium transition-colors flex items-center gap-2 whitespace-nowrap ${COLORES[color][isActive ? 0 : 1]}`;

/**
 * Menú superior. En pantallas grandes muestra todos los enlaces; en
 * teléfonos y tablets se pliega en un botón ☰.
 */
export default function Navbar({ onLogout }) {
    const isAdmin = authService.isAdmin();
    const username = authService.getUsername();
    const [abierto, setAbierto] = useState(false);
    const enlaces = ENLACES.filter(e => !e.admin || isAdmin);

    const etiquetaRol = (
        <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 ml-1">{isAdmin ? 'Admin' : 'Vendedor'}</span>
    );

    return (
        <nav className="bg-white shadow-sm border-b border-gray-200 relative z-30">
            <div className="flex items-center justify-between px-4 py-2 min-[1440px]:py-4 gap-4">
                <div className="flex items-center gap-2 min-w-0">
                    <h1 className="text-lg min-[1440px]:text-xl font-black text-blue-900 mr-2 min-[1440px]:mr-4 whitespace-nowrap">Punto de Venta</h1>
                    {/* Enlaces en línea: solo en pantallas grandes */}
                    <div className="hidden min-[1440px]:flex items-center gap-2">
                        {enlaces.map(e => (
                            <NavLink key={e.to} to={e.to} end={e.end} className={claseEnlace(e.color)}>{e.nombre}</NavLink>
                        ))}
                    </div>
                </div>

                <div className="hidden min-[1440px]:flex items-center gap-4">
                    <span className="text-sm text-gray-500 whitespace-nowrap">{username} {etiquetaRol}</span>
                    <button onClick={onLogout}
                        className="px-6 py-2 text-red-600 bg-red-50 border border-red-200 hover:bg-red-100 hover:border-red-300 rounded-lg font-medium transition-colors cursor-pointer whitespace-nowrap">
                        Cerrar Sesion
                    </button>
                </div>

                <button onClick={() => setAbierto(a => !a)} aria-label="Menú" aria-expanded={abierto}
                    className="min-[1440px]:hidden p-2 rounded-lg hover:bg-gray-100 text-slate-700 cursor-pointer">
                    {abierto ? <X className="w-6 h-6" /> : <IconoMenu className="w-6 h-6" />}
                </button>
            </div>

            {/* Menú desplegable (teléfonos y tablets) */}
            {abierto && (
                <div className="min-[1440px]:hidden absolute inset-x-0 top-full bg-white border-b border-gray-200 shadow-lg p-3 space-y-1">
                    {enlaces.map(e => (
                        <NavLink key={e.to} to={e.to} end={e.end} onClick={() => setAbierto(false)}
                            className={({ isActive }) => `block px-4 py-3 rounded-lg font-medium ${
                                isActive ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-gray-100'}`}>
                            {e.nombre}
                        </NavLink>
                    ))}
                    <div className="flex items-center justify-between gap-3 pt-3 mt-2 border-t border-gray-100">
                        <span className="text-sm text-gray-500 px-1">{username} {etiquetaRol}</span>
                        <button onClick={onLogout}
                            className="px-4 py-2 text-red-600 bg-red-50 border border-red-200 rounded-lg font-medium cursor-pointer">
                            Cerrar Sesion
                        </button>
                    </div>
                </div>
            )}
        </nav>
    );
}
