import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Register from './pages/Register';
import Login from './pages/Login';
import IngresoFactura from './components/POS/IngresoFactura';
import RegistroFacturas from './components/POS/RegistroFacturas';
import GestorPromociones from './components/POS/GestorPromociones';
import AppLayout from './components/AppLayout';
import ProtectedRoute from './components/ProtectedRoute';
import AdminRoute from './components/AdminRoute';

function App() {
    return (
        <BrowserRouter>
            <Routes>
                <Route path="/login" element={<Login />} />

                {/* Rutas protegidas dentro del layout con Navbar */}
                <Route
                    element={
                        <ProtectedRoute>
                            <AppLayout />
                        </ProtectedRoute>
                    }
                >
                    {/* Rutas accesibles por todos los usuarios autenticados */}
                    <Route index element={<Register />} />
                    <Route path="compras" element={<IngresoFactura />} />

                    {/* Rutas solo para administradores */}
                    <Route path="historial" element={<AdminRoute><RegistroFacturas /></AdminRoute>} />
                    <Route path="promociones" element={<AdminRoute><GestorPromociones /></AdminRoute>} />
                </Route>

                {/* Cualquier ruta desconocida redirige a la caja */}
                <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
        </BrowserRouter>
    );
}

export default App;
