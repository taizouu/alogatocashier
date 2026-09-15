import React, { useState, useEffect } from 'react';
import Register from './pages/Register';
import Login from './pages/Login';
import IngresoFactura from './components/POS/IngresoFactura';
import Navbar from './components/POS/Navbar';// Ajusta la ruta según dónde guardes el archivo
import { authService } from './services/api';
import RegistroFacturas from './components/POS/RegistroFacturas';
import GestorPromociones from './components/POS/GestorPromociones';

function App() {
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [vistaActual, setVistaActual] = useState('CAJA'); 

    useEffect(() => {
        const token = authService.getToken();
        if (token) {
            setIsAuthenticated(true);
        }
    }, []);

    const handleLoginSuccess = () => {
        setIsAuthenticated(true);
    };

    const handleLogout = () => {
        authService.logout();
        setIsAuthenticated(false);
        setVistaActual('CAJA'); 
    };

    return (
        <>
            {!isAuthenticated ? (
                <Login onLoginSuccess={handleLoginSuccess} />
            ) : (
                <div className="min-h-screen bg-gray-100 flex flex-col">
                    
                    {/* Componente Navbar inyectado aquí */}
                    <Navbar 
                        vistaActual={vistaActual} 
                        setVistaActual={setVistaActual} 
                        onLogout={handleLogout} 
                    />

                    <main className="flex-1 overflow-auto">
                        {vistaActual === 'CAJA' && <Register onLogout={handleLogout} />}
                        {vistaActual === 'COMPRAS' && <IngresoFactura />}
                        {vistaActual === 'HISTORIAL' && <RegistroFacturas />}
                        {vistaActual === 'PROMOCIONES' && <GestorPromociones />}
                    </main>
                </div>
            )}
        </>
    );
}

export default App;