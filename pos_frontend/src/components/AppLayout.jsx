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
        <div className="min-h-screen bg-gray-100 flex flex-col">
            <Navbar onLogout={handleLogout} />
            <main className="flex-1 overflow-auto">
                <Outlet context={{ onLogout: handleLogout }} />
            </main>
        </div>
    );
}
