import React, { useState, useEffect } from 'react';
import Register from './pages/Register';
import Login from './pages/Login';
import { authService } from './services/api';

function App() {
    const [isAuthenticated, setIsAuthenticated] = useState(false);

    useEffect(() => {
        // Al cargar la aplicación, revisamos si el cajero ya tiene un token válido guardado
        const token = authService.getToken();
        if (token) {
            setIsAuthenticated(true);
        }
    }, []);

    const handleLoginSuccess = () => {
        // Esta función se ejecuta desde Login.jsx cuando las credenciales son correctas
        setIsAuthenticated(true);
    };

    const handleLogout = () => {
        // Borra el token y devuelve al usuario a la pantalla de inicio
        authService.logout();
        setIsAuthenticated(false);
    };

    return (
        <>
            {!isAuthenticated ? (
                <Login onLoginSuccess={handleLoginSuccess} />
            ) : (
                <Register onLogout={handleLogout} />
            )}
        </>
    );
}

export default App;