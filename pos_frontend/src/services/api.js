import axios from 'axios';

const apiClient = axios.create({
    baseURL: 'http://127.0.0.1:8000', // Asegúrate de que coincida con tu backend
    headers: {
        'Content-Type': 'application/json',
    },
});

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

export const posService = {
    buscarProducto: async (codigo) => {
        const response = await apiClient.get(`/api/buscar-producto/?codigo=${codigo}`);
        return response.data;
    },
    
    buscarProductoPorNombre: async (nombre) => {
        const response = await apiClient.get(`/api/buscar-producto-nombre/?nombre=${nombre}`);
        return response.data;
    },
    
    procesarVenta: async (datosVenta) => {
        const response = await apiClient.post('/api/procesar-venta/', datosVenta);
        return response.data;
    },
    
    abrirCaja: async (datos) => {
        const response = await apiClient.post('/api/abrir-caja/', datos);
        return response.data;
    },
    
    obtenerPromocionesActivas: async () => {
        // CORREGIDO: apiClient en lugar de api
        const response = await apiClient.get('/api/promociones-activas/'); 
        return response.data;
    },

    obtenerTodasPromociones: async () => {
        const response = await apiClient.get('/api/promociones/');
        return response.data;
    },

    crearPromocion: async (datosPromo) => {
        const response = await apiClient.post('/api/promociones/', datosPromo);
        return response.data;
    },

    eliminarPromocion: async (id) => {
        const response = await apiClient.delete(`/api/promociones/${id}/`);
        return response.data;
    },

    estadoCaja: async () => {
        const response = await apiClient.get('/api/estado-caja/');
        return response.data;
    },

    cerrarCaja: async (datos) => {
        const response = await apiClient.post('/api/cerrar-caja/', datos);
        return response.data;
    },
};

// --- SERVICIOS DE COMPRAS ---
export const comprasService = {
    ingresarFactura: async (datosFactura) => {
        const response = await apiClient.post('/api/compras/ingresar/', datosFactura);
        return response.data;
    },
    obtenerProveedores: async () => {
        const response = await apiClient.get('/api/compras/proveedores/');
        return response.data;
    },
    crearProveedor: async (datosProveedor) => {
        const response = await apiClient.post('/api/compras/proveedores/', datosProveedor);
        return response.data;
    },
    obtenerFacturas: async () => {
        const response = await apiClient.get('/api/compras/facturas/');
        return response.data;
    }
};