import axios from 'axios';

const apiClient = axios.create({
    baseURL: 'http://127.0.0.1:8000',
    headers: {
        'Content-Type': 'application/json',
    },
});

// --- INTERCEPTOR DE REQUEST: Agrega el token a cada petición ---
apiClient.interceptors.request.use((config) => {
    const token = localStorage.getItem('token');
    if (token) {
        config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
}, (error) => {
    return Promise.reject(error);
});

// --- INTERCEPTOR DE RESPONSE: Renueva el token si expira ---
let isRefreshing = false;
let failedQueue = [];

const processQueue = (error, token = null) => {
    failedQueue.forEach(({ resolve, reject }) => {
        if (error) {
            reject(error);
        } else {
            resolve(token);
        }
    });
    failedQueue = [];
};

apiClient.interceptors.response.use(
    (response) => response,
    async (error) => {
        const originalRequest = error.config;

        // Si el error no es 401 o ya intentamos renovar, rechazamos
        if (error.response?.status !== 401 || originalRequest._retry) {
            return Promise.reject(error);
        }

        // No intentar refresh en las rutas de autenticacion
        if (originalRequest.url?.includes('/api/auth/')) {
            return Promise.reject(error);
        }

        // Si ya hay un refresh en curso, encolamos esta peticion
        if (isRefreshing) {
            return new Promise((resolve, reject) => {
                failedQueue.push({ resolve, reject });
            }).then((token) => {
                originalRequest.headers.Authorization = `Bearer ${token}`;
                return apiClient(originalRequest);
            });
        }

        originalRequest._retry = true;
        isRefreshing = true;

        const refreshToken = localStorage.getItem('refreshToken');

        if (!refreshToken) {
            isRefreshing = false;
            authService.logout();
            window.location.href = '/login';
            return Promise.reject(error);
        }

        try {
            const response = await axios.post('http://127.0.0.1:8000/api/auth/refresh/', {
                refresh: refreshToken,
            });

            const newAccessToken = response.data.access;
            localStorage.setItem('token', newAccessToken);

            // Si el backend rota el refresh token, guardamos el nuevo
            if (response.data.refresh) {
                localStorage.setItem('refreshToken', response.data.refresh);
            }

            processQueue(null, newAccessToken);

            originalRequest.headers.Authorization = `Bearer ${newAccessToken}`;
            return apiClient(originalRequest);
        } catch (refreshError) {
            processQueue(refreshError, null);
            authService.logout();
            window.location.href = '/login';
            return Promise.reject(refreshError);
        } finally {
            isRefreshing = false;
        }
    }
);

// --- SERVICIO DE AUTENTICACION ---
export const authService = {
    login: async (username, password) => {
        const response = await apiClient.post('/api/auth/login/', { username, password });
        if (response.data.access) {
            localStorage.setItem('token', response.data.access);
        }
        if (response.data.refresh) {
            localStorage.setItem('refreshToken', response.data.refresh);
        }
        return response.data;
    },
    logout: () => {
        localStorage.removeItem('token');
        localStorage.removeItem('refreshToken');
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
