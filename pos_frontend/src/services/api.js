import axios from 'axios';

// Dirección del servidor Django. Por defecto, el mismo equipo desde el que se abrió
// la caja (puerto 8000): así funciona igual en el PC (localhost) y desde el
// teléfono en la red local (192.168.x.x). Se puede fijar con VITE_API_URL.
export const API_URL = (import.meta.env?.VITE_API_URL ||
    `${window.location.protocol}//${window.location.hostname}:8000`).replace(/\/$/, '');

const apiClient = axios.create({
    baseURL: API_URL,
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
            const response = await axios.post(`${API_URL}/api/auth/refresh/`, {
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

// --- HELPER: Decodificar payload del JWT sin dependencias externas ---
const decodeJwtPayload = (token) => {
    try {
        const base64Url = token.split('.')[1];
        const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
        const jsonPayload = decodeURIComponent(
            atob(base64).split('').map(c =>
                '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)
            ).join('')
        );
        return JSON.parse(jsonPayload);
    } catch {
        return null;
    }
};

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
    },
    getUserRole: () => {
        const token = localStorage.getItem('token');
        if (!token) return null;
        const payload = decodeJwtPayload(token);
        return payload?.rol || 'VENDEDOR';
    },
    getUsername: () => {
        const token = localStorage.getItem('token');
        if (!token) return null;
        const payload = decodeJwtPayload(token);
        return payload?.username || '';
    },
    isAdmin: () => {
        return authService.getUserRole() === 'ADMIN';
    },
};

export const posService = {
    buscarProducto: async (codigo) => {
        const response = await apiClient.get(`/api/buscar-producto/?codigo=${codigo}`);
        return response.data;
    },

    // Grupos de los botones de acceso rápido (Caps, Puntas) con sus productos
    obtenerAccesosRapidos: async () => {
        const response = await apiClient.get('/api/acceso-rapido/');
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

    actualizarPromocion: async (id, datosPromo) => {
        const response = await apiClient.patch(`/api/promociones/${id}/`, datosPromo);
        return response.data;
    },

    // Proveedores, tipos y etiquetas del catálogo de Shopify para los filtros
    obtenerOpcionesPromocion: async (refrescar = false) => {
        const response = await apiClient.get('/api/promociones/opciones/', {
            params: refrescar ? { refrescar: 1 } : {},
        });
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
    },
    asociarCodigoBarras: async (variantId, barcode, reemplazar = false) => {
        const response = await apiClient.post('/api/compras/asociar-codigo/', {
            variant_id: variantId,
            barcode,
            reemplazar,
        });
        return response.data;
    },
};

// --- HISTORIAL DE VENTAS (Solo Admin) ---
// filtros: { desde, hasta, metodo_pago, q, page } — fechas AAAA-MM-DD
const limpiarFiltros = (filtros) =>
    Object.fromEntries(Object.entries(filtros).filter(([, v]) => v !== '' && v != null));

export const ventasService = {
    listar: async (filtros = {}) => {
        const response = await apiClient.get('/api/ventas/', { params: limpiarFiltros(filtros) });
        return response.data;
    },
    resumen: async (filtros = {}) => {
        const response = await apiClient.get('/api/ventas/resumen/', { params: limpiarFiltros(filtros) });
        return response.data;
    },
    detalle: async (id) => {
        const response = await apiClient.get(`/api/ventas/${id}/`);
        return response.data;
    },
    // { venta, tienda } para imprimir. Vendedores: solo ventas de la caja abierta
    comprobante: async (id) => {
        const response = await apiClient.get(`/api/ventas/${id}/comprobante/`);
        return response.data;
    },
    // datos: { items: [{ detalle_id, cantidad }], motivo, metodo_reembolso, repone_stock }
    devolver: async (id, datos) => {
        const response = await apiClient.post(`/api/ventas/${id}/devoluciones/`, datos);
        return response.data;
    },
};

// --- BOLETAS Y FACTURAS ELECTRÓNICAS (OpenFactura) ---
export const documentosService = {
    configuracion: async () => (await apiClient.get('/api/documentos/configuracion/')).data,
    listar: async (filtros = {}) => (await apiClient.get('/api/documentos/', { params: limpiarFiltros(filtros) })).data,
    reintentar: async (id, confirmado = false) => (await apiClient.post(`/api/documentos/${id}/reintentar/`, { confirmado })).data,
    actualizarEstado: async (id) => (await apiClient.post(`/api/documentos/${id}/estado/`)).data,
    pdf: async (id) => (await apiClient.get(`/api/documentos/${id}/pdf/`, { responseType: 'blob' })).data,
    contribuyente: async (rut) => (await apiClient.get(`/api/contribuyente/${encodeURIComponent(rut.trim())}/`)).data,
};

// --- PAGO REMOTO TUU (la caja envía el cobro con tarjeta al POS) ---
export const pagoRemotoService = {
    configuracion: async () => (await apiClient.get('/api/pagos-tuu/configuracion/')).data,
    // metodo: 'DEBITO' | 'CREDITO'
    crear: async (monto, metodo) => (await apiClient.post('/api/pagos-tuu/', { monto, metodo })).data,
    estado: async (id) => (await apiClient.get(`/api/pagos-tuu/${id}/`)).data,
    sinVenta: async () => (await apiClient.get('/api/pagos-tuu/sin-venta/')).data,
    // Cobro aprobado sin venta que se anuló en el POS
    descartar: async (id) => (await apiClient.post(`/api/pagos-tuu/${id}/descartar/`)).data,
};

// --- SERVICIOS DE USUARIOS (Solo Admin) ---
export const usuariosService = {
    obtenerUsuarios: async () => {
        const response = await apiClient.get('/api/auth/usuarios/');
        return response.data;
    },
    crearUsuario: async (datosUsuario) => {
        const response = await apiClient.post('/api/auth/usuarios/', datosUsuario);
        return response.data;
    },
    actualizarUsuario: async (id, datosUsuario) => {
        const response = await apiClient.patch(`/api/auth/usuarios/${id}/`, datosUsuario);
        return response.data;
    },
};
