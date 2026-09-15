import React from 'react';

export default function Navbar({ vistaActual, setVistaActual, onLogout }) {
    // EL CANDADO DEL FUTURO: 
    // Cuando integres roles, esta variable leerá si el usuario logueado es admin
    const isAdmin = true; 

    return (
        <nav className="flex items-center justify-between p-4 bg-white shadow-sm border-b border-gray-200">
            
            {/* Controles de Navegación Izquierdos */}
            <div className="flex items-center gap-4">
                <h1 className="text-xl font-black text-blue-900 mr-4">Punto de Venta</h1>
                
                <button 
                    onClick={() => setVistaActual('CAJA')}
                    className={`px-4 py-2 rounded-lg font-medium transition-colors flex items-center gap-2 ${
                        vistaActual === 'CAJA' 
                        ? 'bg-gray-200 text-gray-800' 
                        : 'hover:bg-gray-100 text-gray-600'
                    }`}
                >
                    Caja POS
                </button>
                
                <button 
                    onClick={() => setVistaActual('COMPRAS')}
                    className={`px-4 py-2 rounded-lg font-medium transition-colors flex items-center gap-2 ${
                        vistaActual === 'COMPRAS' 
                        ? 'bg-blue-600 text-white' 
                        : 'hover:bg-blue-50 text-blue-600'
                    }`}
                >
                    Ingresar Factura
                </button>

                {/* NUEVO BOTÓN RESTRINGIDO: Solo se renderiza si isAdmin es true */}
                {isAdmin && (
                    <button 
                        onClick={() => setVistaActual('HISTORIAL')}
                        className={`px-4 py-2 rounded-lg font-medium transition-colors flex items-center gap-2 ml-4 ${
                            vistaActual === 'HISTORIAL' 
                            ? 'bg-purple-600 text-white shadow-md' 
                            : 'border border-purple-300 text-purple-700 hover:bg-purple-50'
                        }`}
                        title="Solo visible para Administradores"
                    >
                        Historial Facturas
                    </button>,

                    <button 
                        onClick={() => setVistaActual('PROMOCIONES')}
                        className={`px-4 py-2 rounded-lg font-medium transition-colors flex items-center gap-2 ml-2 ${
                            vistaActual === 'PROMOCIONES' 
                            ? 'bg-emerald-600 text-white shadow-md' 
                            : 'border border-emerald-300 text-emerald-700 hover:bg-emerald-50'
                        }`}
                    >
                        Promociones
                    </button>
                )}
            </div>

            {/* Controles Derechos */}
            <button 
                onClick={onLogout}
                className="px-6 py-2 text-red-600 bg-red-50 border border-red-200 hover:bg-red-100 hover:border-red-300 rounded-lg font-medium transition-colors"
            >
                Cerrar Sesión
            </button>
        </nav>
    );
}