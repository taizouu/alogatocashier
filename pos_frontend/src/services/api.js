import axios from 'axios';

const apiClient = axios.create({
    baseURL: 'http://127.0.0.1:8000', // Asegúrate de que coincida con tu backend
    headers: {
        'Content-Type': 'application/json',
    },
});

// --- INTERCEPTOR DE SEGURIDAD ---
// Inyecta el Token de acceso en todas las peticiones automáticamente
apiClient.interceptors.request.use((config) => {
    const token = localStorage.getItem('token');
    if (token) {
        config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
}, (error) => {
    return Promise.reject(error);
});

// --- SERVICIO DE AUTENTICACIÓN ---
export const authService = {
    login: async (username, password) => {
        // Apunta a la URL de SimpleJWT que configuraste en Django
        const response = await apiClient.post('/api/auth/login/', { username, password });
        if (response.data.access) {
            localStorage.setItem('token', response.data.access);
        }
        return response.data;
    },
    logout: () => {
        localStorage.removeItem('token');
    },
    getToken: () => {
        return localStorage.getItem('token');
    }
};

// --- SERVICIOS DE CAJA (POS) ---
export const posService = {
    buscarProducto: async (codigo) => {
        // Ya no necesitamos poner headers manuales, el interceptor lo hace por nosotros
        const response = await apiClient.get(`/api/buscar-producto/?codigo=${codigo}`);
        return response.data;
    },
    
    buscarProductoPorNombre: async (nombre) => {
        const response = await apiClient.get(`/api/buscar-producto-nombre/?nombre=${nombre}`);
        return response.data;
    },
    
    // Agregamos este nuevo método para procesar la venta con los medios de pago
    procesarVenta: async (datosVenta) => {
        const response = await apiClient.post('/api/procesar-venta/', datosVenta);
        return response.data;
    },
    
    abrirCaja: async (datos) => {
        const response = await apiClient.post('/api/abrir-caja/', datos);
        return response.data;
    }
};