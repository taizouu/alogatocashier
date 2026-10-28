import { Outlet, useNavigate } from 'react-router-dom';
import Navbar from './POS/Navbar';
import { authService } from '../services/api';

export default function AppLayout() {
    const navigate = useNavigate();

    const handleLogout = () => {
        authService.logout();
        navigate('/login', { replace: true });
    };

    return (
        // Alto exacto de la pantalla (dvh: descuenta la barra del navegador en el teléfono)
        <div className="h-dvh bg-gray-100 flex flex-col">
            <Navbar onLogout={handleLogout} />
            <main className="flex-1 min-h-0 overflow-auto">
                <Outlet context={{ onLogout: handleLogout }} />
            </main>
        </div>
    );
}
