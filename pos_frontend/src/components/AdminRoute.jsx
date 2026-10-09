import { Navigate } from 'react-router-dom';
import { authService } from '../services/api';

export default function AdminRoute({ children }) {
    if (!authService.isAdmin()) {
        // Si no es admin, redirigir a la caja
        return <Navigate to="/" replace />;
    }

    return children;
}
