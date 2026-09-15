import React, { useState, useEffect, useRef } from 'react';
import ScannerInput from './ScannerInput';
import ModalNuevoProveedor from './ModalNuevoProveedor';
import { posService, comprasService } from '../../services/api';

export default function IngresoFactura() {
    const [paso, setPaso] = useState(1);
    const [cabecera, setCabecera] = useState({
        folio: '',
        proveedor: '',
        fecha_emision: ''
    });
    const [detalles, setDetalles] = useState([]);
    
    const [loading, setLoading] = useState(false);
    const [proveedores, setProveedores] = useState([]);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [busquedaTexto, setBusquedaTexto] = useState('');
    const [sugerencias, setSugerencias] = useState([]);

    // --- REFERENCIAS PARA EL ESCUDO ANTI-ESCÁNER EN LOS INPUTS ---
    const inputScanBuffer = useRef('');
    const inputScanTimeout = useRef(null);
    const lastInputTime = useRef(Date.now());

    useEffect(() => {
        cargarProveedores();
    }, []);

    const cargarProveedores = async () => {
        try {
            const data = await comprasService.obtenerProveedores();
            setProveedores(data);
        } catch (error) {
            console.error("Error al cargar proveedores", error);
        }
    };

    const handleProveedorCreado = (nuevoProveedor) => {
        setProveedores([...proveedores, nuevoProveedor]);
        setCabecera({ ...cabecera, proveedor: nuevoProveedor.id });
        setIsModalOpen(false);
    };

    const handleScan = async (codigo) => {
        try {
            const producto = await posService.buscarProducto(codigo);
            agregarProductoAlDetalle(producto);
        } catch (error) {
            alert("Producto no encontrado por código de barras.");
        }
    };

    const agregarProductoAlDetalle = (producto) => {
        setDetalles(prevDetalles => {
            const skuProducto = producto.codigo_barras || producto.sku;
            const existe = prevDetalles.find(item => item.sku === skuProducto);
            
            if (existe) {
                return prevDetalles.map(item => 
                    item.sku === skuProducto
                        ? { ...item, cantidad: Number(item.cantidad) + 1 } 
                        : item
                );
            }
            
            return [...prevDetalles, {
                sku: skuProducto, 
                shopify_variant_id: producto.id_shopify,
                nombre: producto.nombre,
                cantidad: 1,
                costo_unitario: 0 
            }];
        });
    };

    const handleBuscarPorTexto = async (texto) => {
        setBusquedaTexto(texto);
        if (texto.trim().length < 2) {
            setSugerencias([]);
            return;
        }
        try {
            const resultados = await posService.buscarProductoPorNombre(texto);
            setSugerencias(resultados || []);
        } catch (error) {
            console.error("Error al buscar productos:", error);
            setSugerencias([]);
        }
    };

    const agregarProductoDesdeBusqueda = (producto) => {
        agregarProductoAlDetalle(producto);
        setBusquedaTexto('');
        setSugerencias([]);
    };

    const actualizarDetalle = (sku, campo, valor) => {
        setDetalles(prev => prev.map(item => 
            item.sku === sku ? { ...item, [campo]: valor === '' ? '' : Number(valor) } : item
        ));
    };

    const eliminarProducto = (skuAEliminar) => {
        setDetalles(prev => prev.filter(item => item.sku !== skuAEliminar));
    };

    const handleCancelar = () => {
        if (window.confirm("¿Estás seguro de que deseas cancelar este ingreso? Se perderán todos los datos y productos escaneados.")) {
            setCabecera({ folio: '', proveedor: '', fecha_emision: '' });
            setDetalles([]);
            setPaso(1);
            setBusquedaTexto('');
            setSugerencias([]);
        }
    };

    const handleGuardarFactura = async () => {
        setLoading(true);
        try {
            const payload = {
                ...cabecera,
                detalles: detalles.map(({ nombre, ...resto }) => resto) 
            };

            const response = await comprasService.ingresarFactura(payload);
            alert("¡Éxito! " + response.mensaje);
            
            setCabecera({ folio: '', proveedor: '', fecha_emision: '' });
            setDetalles([]);
            setPaso(1);
        } catch (error) {
            console.error("Error:", error.response?.data);
            alert("Hubo un error al procesar la factura.");
        } finally {
            setLoading(false);
        }
    };

    const calcularTotal = () => {
        return detalles.reduce((total, item) => total + (Number(item.costo_unitario) * Number(item.cantidad)), 0);
    };
    
    const calcularUnidades = () => {
        return detalles.reduce((total, item) => total + Number(item.cantidad), 0);
    };

    // --- LÓGICA INTELIGENTE ANTI-CORRUPCIÓN DE INPUTS ---
    const handleInputKeyDown = (e, sku, campo, valorOriginal) => {
        // Permitimos que el humano borre o navegue sin problemas
        if (e.key === 'Backspace' || e.key === 'Tab' || e.key.startsWith('Arrow')) return;

        const now = Date.now();
        const timeDiff = now - lastInputTime.current;
        lastInputTime.current = now;

        // Si las teclas entran en menos de 30ms, es la pistola escaneando
        if (timeDiff < 30 || inputScanBuffer.current.length > 1) {
            e.stopPropagation(); // Bloquea al componente global para evitar duplicados
            
            if (e.key === 'Enter') {
                e.preventDefault();
                if (inputScanBuffer.current.length > 3) {
                    // 1. Enviamos el código atrapado a Shopify
                    handleScan(inputScanBuffer.current);
                    
                    // 2. Restauramos la celda a la cantidad que tenía el usuario originalmente
                    actualizarDetalle(sku, campo, valorOriginal);
                }
                inputScanBuffer.current = '';
                e.target.blur(); // Quitamos el cursor de la celda por seguridad
                return;
            }

            // Atrapamos la letra/número y evitamos que se escriba en la celda
            inputScanBuffer.current += e.key;
            e.preventDefault(); 
        } else {
            // Primer impacto (puede ser humano tecleando, o la primera letra de la pistola)
            if (e.key.length === 1) {
                inputScanBuffer.current = e.key;
            }
        }

        // Limpiamos el buffer si el humano está simplemente tecleando lento
        clearTimeout(inputScanTimeout.current);
        inputScanTimeout.current = setTimeout(() => {
            inputScanBuffer.current = '';
        }, 50);
    };

    return (
        <div className="p-6 bg-gray-50 min-h-screen">
            {paso === 2 && <ScannerInput onScan={handleScan} />}

            <div className="bg-white rounded-lg p-8 w-full max-w-5xl mx-auto shadow-xl border border-gray-100">
                <h2 className="text-2xl font-bold mb-8 text-gray-800 text-center">Ingreso de Mercadería</h2>
                
                {/* Stepper */}
                <div className="flex items-center justify-center mb-10">
                    <div className={`flex items-center ${paso >= 1 ? 'text-blue-600' : 'text-gray-400'}`}>
                        <div className={`rounded-full h-10 w-10 flex items-center justify-center border-2 font-bold ${paso >= 1 ? 'border-blue-600 bg-blue-50' : 'border-gray-300'}`}>1</div>
                        <span className="ml-2 font-medium hidden sm:block">Documento</span>
                    </div>
                    <div className={`w-16 h-1 mx-4 rounded ${paso >= 2 ? 'bg-blue-600' : 'bg-gray-200'}`}></div>
                    
                    <div className={`flex items-center ${paso >= 2 ? 'text-blue-600' : 'text-gray-400'}`}>
                        <div className={`rounded-full h-10 w-10 flex items-center justify-center border-2 font-bold ${paso >= 2 ? 'border-blue-600 bg-blue-50' : 'border-gray-300'}`}>2</div>
                        <span className="ml-2 font-medium hidden sm:block">Escaneo / Búsqueda</span>
                    </div>
                    <div className={`w-16 h-1 mx-4 rounded ${paso === 3 ? 'bg-blue-600' : 'bg-gray-200'}`}></div>
                    
                    <div className={`flex items-center ${paso === 3 ? 'text-blue-600' : 'text-gray-400'}`}>
                        <div className={`rounded-full h-10 w-10 flex items-center justify-center border-2 font-bold ${paso === 3 ? 'border-blue-600 bg-blue-50' : 'border-gray-300'}`}>3</div>
                        <span className="ml-2 font-medium hidden sm:block">Confirmación</span>
                    </div>
                </div>

                {/* PASO 1 */}
                {paso === 1 && (
                    <div className="animate-fade-in">
                        <div className="bg-gray-50 p-6 rounded-lg border border-gray-200 space-y-6">
                            <h3 className="text-lg font-semibold text-gray-700 border-b pb-2">Datos de la Factura</h3>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-2">Folio Factura</label>
                                    <input 
                                        type="text" 
                                        placeholder="Ej: 15480"
                                        className="w-full p-3 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                                        value={cabecera.folio}
                                        onChange={e => setCabecera({...cabecera, folio: e.target.value})}
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-2">Proveedor</label>
                                    <div className="flex gap-2 items-stretch">
                                        <select 
                                            className="flex-1 min-w-0 p-3 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                                            value={cabecera.proveedor}
                                            onChange={e => setCabecera({...cabecera, proveedor: e.target.value})}
                                        >
                                            <option value="">Seleccione...</option>
                                            {proveedores.map(prov => (
                                                <option key={prov.id} value={prov.id}>
                                                    {prov.razon_social} ({prov.rut})
                                                </option>
                                            ))}
                                        </select>
                                        <button 
                                            type="button"
                                            onClick={() => setIsModalOpen(true)}
                                            className="flex-shrink-0 w-12 flex items-center justify-center bg-blue-100 text-blue-700 border border-blue-300 rounded-lg text-xl font-bold hover:bg-blue-200 transition-colors"
                                            title="Agregar nuevo proveedor"
                                        >
                                            +
                                        </button>
                                    </div>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-2">Fecha Emisión</label>
                                    <input 
                                        type="date" 
                                        className="w-full p-3 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                                        value={cabecera.fecha_emision}
                                        onChange={e => setCabecera({...cabecera, fecha_emision: e.target.value})}
                                    />
                                </div>
                            </div>
                        </div>
                        
                        <div className="flex justify-end mt-8">
                            <button
                                onClick={() => setPaso(2)}
                                disabled={!cabecera.folio || !cabecera.proveedor || !cabecera.fecha_emision}
                                className="px-8 py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                Siguiente: Recepción de Productos ➔
                            </button>
                        </div>
                    </div>
                )}

                {/* PASO 2 */}
                {paso === 2 && (
                    <div className="animate-fade-in">
                        <div className="mb-6">
                            <h3 className="text-lg font-semibold text-gray-700 mb-2">Agregar Productos (Escáner o Búsqueda)</h3>
                            
                            <div className="relative">
                                <input 
                                    type="text"
                                    placeholder="🔍 Escribe el nombre o clasificación para buscar manualmente..."
                                    className="w-full p-3 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 bg-white shadow-sm"
                                    value={busquedaTexto}
                                    onChange={(e) => handleBuscarPorTexto(e.target.value)}
                                />
                                
                                {sugerencias.length > 0 && (
                                    <ul className="absolute z-20 w-full bg-white border border-gray-200 rounded-lg shadow-xl mt-1 max-h-60 overflow-y-auto">
                                        {sugerencias.map((prod, idx) => (
                                            <li 
                                                key={idx}
                                                onClick={() => agregarProductoDesdeBusqueda(prod)}
                                                className="p-3 hover:bg-blue-50 cursor-pointer border-b border-gray-100 flex justify-between items-center transition-colors"
                                            >
                                                <div>
                                                    <span className="font-medium text-gray-800 block">{prod.nombre}</span>
                                                    <span className="text-xs text-gray-500 font-mono">SKU: {prod.sku || 'N/A'}</span>
                                                </div>
                                                <span className="text-sm font-semibold text-blue-600 bg-blue-50 px-2 py-1 rounded">Agregar +</span>
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </div>
                        </div>

                        <div className="border border-gray-200 rounded-lg overflow-hidden mb-6 bg-white shadow-sm">
                            <table className="w-full text-left">
                                <thead className="bg-gray-50 border-b border-gray-200">
                                    <tr>
                                        <th className="p-4 text-sm font-semibold text-gray-600">SKU / Código</th>
                                        <th className="p-4 text-sm font-semibold text-gray-600">Producto</th>
                                        <th className="p-4 text-sm font-semibold text-gray-600">Costo Unit. Neto ($)</th>
                                        <th className="p-4 text-sm font-semibold text-gray-600">Cant. Recibida</th>
                                        <th className="p-4 text-sm font-semibold text-gray-600 text-right">Subtotal</th>
                                        <th className="p-4 w-12"></th> 
                                    </tr>
                                </thead>
                                <tbody>
                                    {detalles.length === 0 ? (
                                        <tr>
                                            <td colSpan="6" className="p-12 text-center text-gray-500 bg-gray-50/50">
                                                <span className="text-4xl block mb-3">📦</span>
                                                Escanea con la pistola o usa el buscador de arriba para agregar productos...
                                            </td>
                                        </tr>
                                    ) : (
                                        detalles.map((item, index) => (
                                            <tr key={index} className="border-b border-gray-100 hover:bg-gray-50 transition-colors last:border-0">
                                                <td className="p-4 font-mono text-sm text-gray-500">{item.sku}</td>
                                                <td className="p-4 font-medium text-gray-800">{item.nombre}</td>
                                                <td className="p-4">
                                                    <input 
                                                        type="number" 
                                                        className="w-28 p-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 outline-none"
                                                        value={item.costo_unitario}
                                                        onFocus={(e) => e.target.select()} // Selecciona todo el texto al hacer clic
                                                        onKeyDown={(e) => handleInputKeyDown(e, item.sku, 'costo_unitario', item.costo_unitario)}
                                                        onChange={e => actualizarDetalle(item.sku, 'costo_unitario', e.target.value)}
                                                    />
                                                </td>
                                                <td className="p-4">
                                                    <input 
                                                        type="number" 
                                                        className="w-24 p-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 outline-none font-bold text-center"
                                                        value={item.cantidad}
                                                        onFocus={(e) => e.target.select()}
                                                        onKeyDown={(e) => handleInputKeyDown(e, item.sku, 'cantidad', item.cantidad)}
                                                        onChange={e => actualizarDetalle(item.sku, 'cantidad', e.target.value)}
                                                    />
                                                </td>
                                                <td className="p-4 text-right font-semibold text-gray-700">
                                                    ${(Number(item.costo_unitario) * Number(item.cantidad)).toLocaleString('es-CL')}
                                                </td>
                                                <td className="p-4 text-center">
                                                    <button
                                                        onClick={() => eliminarProducto(item.sku)}
                                                        className="text-red-500 hover:text-red-700 p-2 rounded-full hover:bg-red-50 transition-colors"
                                                        title="Quitar producto"
                                                    >
                                                        🗑️
                                                    </button>
                                                </td>
                                            </tr>
                                        ))
                                    )}
                                </tbody>
                            </table>
                        </div>

                        <div className="flex justify-between mt-8 pt-4 border-t border-gray-100">
                            <div className="flex gap-4">
                                <button
                                    onClick={handleCancelar}
                                    className="px-6 py-3 text-red-600 font-medium hover:bg-red-50 rounded-lg transition-colors"
                                >
                                    Cancelar Ingreso
                                </button>
                                <button
                                    onClick={() => setPaso(1)}
                                    className="px-6 py-3 bg-gray-200 text-gray-700 rounded-lg font-medium hover:bg-gray-300 transition-colors"
                                >
                                    🠔 Volver
                                </button>
                            </div>
                            <button
                                onClick={() => setPaso(3)}
                                disabled={detalles.length === 0}
                                className="px-8 py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                Siguiente: Cuadratura ➔
                            </button>
                        </div>
                    </div>
                )}

                {/* PASO 3 */}
                {paso === 3 && (
                    <div className="animate-fade-in max-w-2xl mx-auto">
                        <div className="bg-blue-50 rounded-xl p-8 border border-blue-100 text-center mb-8">
                            <h3 className="text-2xl font-bold text-blue-900 mb-2">Resumen de Recepción</h3>
                            <p className="text-blue-700 mb-6">Revisa que estos valores coincidan con tu factura física antes de procesar.</p>
                            
                            <div className="grid grid-cols-2 gap-4">
                                <div className="bg-white p-4 rounded-lg shadow-sm border border-blue-100">
                                    <div className="text-sm text-gray-500 font-medium mb-1">Total Unidades Físicas</div>
                                    <div className="text-3xl font-black text-gray-800">{calcularUnidades()}</div>
                                </div>
                                <div className="bg-white p-4 rounded-lg shadow-sm border border-blue-100">
                                    <div className="text-sm text-gray-500 font-medium mb-1">Costo Neto Total</div>
                                    <div className="text-3xl font-black text-blue-600">${calcularTotal().toLocaleString('es-CL')}</div>
                                </div>
                            </div>
                        </div>

                        <div className="flex justify-between mt-8">
                            <div className="flex gap-4">
                                <button
                                    onClick={handleCancelar}
                                    className="px-6 py-3 text-red-600 font-medium hover:bg-red-50 rounded-lg transition-colors"
                                >
                                    Cancelar Ingreso
                                        </button>
                                        <button
                                            onClick={() => setPaso(2)}
                                            disabled={!cabecera.folio || !cabecera.proveedor || !cabecera.fecha_emision}
                                            className="px-8 py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                        >
                                    🠔 Editar Productos
                                </button>
                            </div>
                            <button
                                onClick={handleGuardarFactura}
                                disabled={loading}
                                className="px-8 py-3 bg-green-600 text-white rounded-lg font-bold hover:bg-green-700 shadow-lg shadow-green-200 transition-all disabled:opacity-50 flex items-center gap-2"
                            >
                                {loading ? "Sincronizando..." : "✔️ Confirmar y Actualizar Shopify"}
                            </button>
                        </div>
                    </div>
                )}
            </div>

            {isModalOpen && (
                <ModalNuevoProveedor 
                    onClose={() => setIsModalOpen(false)}
                    onProveedorCreado={handleProveedorCreado}
                />
            )}
        </div>
    );
}