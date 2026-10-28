import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useOutletContext } from 'react-router-dom';
import { ShoppingCart, CreditCard, Banknote, Lock, Plus, Minus, Trash2, XCircle, Search, LogOut, Package } from 'lucide-react';
import ScannerInput from '../components/POS/ScannerInput';
import { posService } from '../services/api';
import ModalPago from '../components/POS/ModalPago';
import ModalAbrirCaja from '../components/POS/ModalAbrirCaja';
import ModalCerrarCaja from '../components/POS/ModalCerrarCaja';
import { aplicarPromociones } from '../utils/promociones';
import ModalComprobante from '../components/POS/ModalComprobante';
import ModalAccesoRapido from '../components/POS/ModalAccesoRapido';
import ModalEscanerCamara from '../components/POS/ModalEscanerCamara';
import { variantesCodigo } from '../utils/lectorCodigos';

// Ícono de cámara (dibujado aquí para no depender del nombre del ícono en lucide)
const IconoCamara = ({ className }) => (
  <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4 7h3l2-3h6l2 3h3a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1z" />
    <circle cx="12" cy="13" r="4" />
  </svg>
);

export default function Register() {
  const { onLogout } = useOutletContext();
  const [busqueda, setBusqueda] = useState("");
  const [resultadosBusqueda, setResultadosBusqueda] = useState([]);
  const [buscando, setBuscando] = useState(false);
  const [cart, setCart] = useState([]);
  const [modalPagoAbierto, setModalPagoAbierto] = useState(false);
  const [metodoInicial, setMetodoInicial] = useState('EFECTIVO');
  const [modalAperturaAbierto, setModalAperturaAbierto] = useState(false);
  const [modalCierreAbierto, setModalCierreAbierto] = useState(false);
  
  const [promociones, setPromociones] = useState([]);

  // La caja suele quedar abierta todo el día: recargamos las promociones cada
  // minuto y al volver a la pestaña, para que las creadas o editadas por el
  // admin (y las que empiezan o vencen por fecha) se apliquen sin recargar.
  useEffect(() => {
      const cargarPromos = async () => {
          try {
              const promosActivas = await posService.obtenerPromocionesActivas();
              setPromociones(promosActivas);
          } catch (error) {
              console.error("Error cargando promociones:", error);
          }
      };
      const alVolver = () => { if (document.visibilityState === 'visible') cargarPromos(); };

      cargarPromos();
      const intervalo = setInterval(cargarPromos, 60000);
      window.addEventListener('focus', cargarPromos);
      document.addEventListener('visibilitychange', alVolver);
      return () => {
          clearInterval(intervalo);
          window.removeEventListener('focus', cargarPromos);
          document.removeEventListener('visibilitychange', alVolver);
      };
  }, []);

  // Motor de promociones (combos, NxM, por mayor, %): ver src/utils/promociones.js
  const { carritoProcesado, totalGeneral } = useMemo(() => {
      const { lineas, total } = aplicarPromociones(cart, promociones);
      return { carritoProcesado: lineas, totalGeneral: total };
  }, [cart, promociones]);
  // Búsqueda en tiempo real
  useEffect(() => {
    if (!busqueda.trim()) {
      setResultadosBusqueda([]);
      setBuscando(false);
      return;
    }

    setBuscando(true);
    const delayDebounceFn = setTimeout(async () => {
      try {
        const resultados = await posService.buscarProductoPorNombre(busqueda);
        setResultadosBusqueda(resultados);
      } catch (error) {
        console.error("Error buscando en tiempo real:", error);
      } finally {
        setBuscando(false);
      }
    }, 300);

    return () => clearTimeout(delayDebounceFn);
  }, [busqueda]);

  const agregarAlCarrito = (productoNuevo) => {
    setCart((prevCart) => {
      const index = prevCart.findIndex(item => item.id_shopify === productoNuevo.id_shopify);
      
      if (index !== -1) {
        const nuevoCart = [...prevCart];
        nuevoCart[index] = { 
            ...nuevoCart[index], 
            cantidad: nuevoCart[index].cantidad + 1 
        };
        return nuevoCart;
      } else {
        // Si no existe en el carrito, lo agregamos con cantidad 1
        return [...prevCart, { ...productoNuevo, cantidad: 1 }];
      }
    });
    
    setBusqueda("");
    setResultadosBusqueda([]);
  };

  const ultimoEscaneoRef = useRef({ time: 0, codigo: '' });

  const handleProductScanned = async (codigoDeBarras) => {
    const ahora = Date.now();
    const TIEMPO_ENFRIAMIENTO_MS = 1500; // 1.5 segundos de bloqueo para el mismo código

    // Si es exactamente el mismo código y pasó muy poco tiempo, ignoramos el disparo
    if (
      ultimoEscaneoRef.current.codigo === codigoDeBarras && 
      (ahora - ultimoEscaneoRef.current.time) < TIEMPO_ENFRIAMIENTO_MS
    ) {
        console.warn("Lectura láser duplicada bloqueada por seguridad.");
        return; // Cortamos la función aquí para que no busque ni agregue nada
    }

    // Registramos este nuevo escaneo como el último válido
    ultimoEscaneoRef.current = { time: ahora, codigo: codigoDeBarras };

    const resultado = await buscarYAgregar(codigoDeBarras);
    if (!resultado.ok) alert(resultado.mensaje);
  };

  // Busca un código (y sus variantes UPC/EAN) y lo agrega a la venta. Devuelve { ok, mensaje }
  const buscarYAgregar = async (codigo) => {
    for (const variante of variantesCodigo(codigo)) {
      try {
        const producto = await posService.buscarProducto(variante);
        agregarAlCarrito(producto);
        return { ok: true, mensaje: `Agregado: ${producto.nombre}` };
      } catch (error) {
        if (error.response?.status !== 404) {
          console.error("Error al buscar producto:", error);
          return { ok: false, mensaje: `No se pudo buscar el código ${codigo}. Revisa la conexión.` };
        }
      }
    }
    return { ok: false, mensaje: `Producto no encontrado (código ${codigo}).` };
  };

  const [camaraAbierta, setCamaraAbierta] = useState(false);

  // --- FUNCIONES DE CARRITO ---
  const handleAumentarCantidad = (id_shopify) => {
    setCart(cart.map(item => 
      item.id_shopify === id_shopify ? { ...item, cantidad: item.cantidad + 1 } : item
    ));
  };

  const handleDisminuirCantidad = (id_shopify) => {
    setCart(cart.map(item => 
      item.id_shopify === id_shopify && item.cantidad > 1 
        ? { ...item, cantidad: item.cantidad - 1 } 
        : item
    ));
  };

  const handleEliminarProducto = (id_shopify) => {
    setCart(cart.filter(item => item.id_shopify !== id_shopify));
  };

  const handleCancelarVenta = () => {
    if (cart.length > 0 && window.confirm("¿Estás seguro de cancelar y limpiar esta venta?")) {
      setCart([]);
    }
  };

  const [comprobanteVentaId, setComprobanteVentaId] = useState(null);

  // --- ACCESO RÁPIDO (Caps, Puntas): productos que no se escanean ---
  const [accesosRapidos, setAccesosRapidos] = useState([]);
  const [grupoAbierto, setGrupoAbierto] = useState(null);
  const [cargandoAcceso, setCargandoAcceso] = useState(null);

  const abrirAccesoRapido = async (clave) => {
    setCargandoAcceso(clave);
    try {
      // Siempre datos frescos (precio y stock); el servidor responde desde su copia en memoria
      const grupos = await posService.obtenerAccesosRapidos();
      setAccesosRapidos(grupos);
      setGrupoAbierto(grupos.find(g => g.clave === clave) || null);
    } catch (error) {
      alert(error.response?.data?.error || 'No se pudieron cargar los productos.');
    } finally {
      setCargandoAcceso(null);
    }
  };

  // Cantidades en la venta por producto, para mostrarlas en el panel
  const cantidadesEnCarrito = useMemo(
    () => Object.fromEntries(cart.map(item => [item.id_shopify, item.cantidad])),
    [cart]
  );

  const handleVentaExitosa = (ventaId) => {
    setCart([]);
    setModalPagoAbierto(false);
    if (ventaId) setComprobanteVentaId(ventaId);
  };

  const abrirPago = (metodo) => {
    if (cart.length === 0) return;
    setMetodoInicial(metodo);
    setModalPagoAbierto(true);
  };
  const unidades = cart.reduce((s, item) => s + item.cantidad, 0);

  return (
    <div className="flex flex-col h-full bg-gray-50 font-sans">
      
      {/* HEADER CON LOGO (compacto en el teléfono) */}
      <header className="bg-slate-900 text-white py-2 px-3 lg:py-3 lg:px-6 shadow-md flex justify-between items-center gap-2 z-10">
        <div className="flex items-center gap-3 min-w-0">
          <img 
            src="/logo.png" 
            alt="Logo AloCat" 
            className="h-8 lg:h-10 w-auto object-contain bg-white rounded-md p-1"
            onError={(e) => { e.target.style.display = 'none'; }} 
          />
          <div className="min-w-0">
            <h1 className="hidden lg:block text-xl font-bold tracking-wide">CAJA Y REGISTROS ALOGATO GRAFFSTORE</h1>
            <h1 className="lg:hidden text-base font-bold tracking-wide truncate">ALOGATO</h1>
            <p className="hidden sm:block text-slate-400 text-xs uppercase tracking-widest">Terminal de Venta POS</p>
          </div>
        </div>
        
        <div className="flex gap-2 lg:gap-3 shrink-0">
          <button
            onClick={() => setModalAperturaAbierto(true)}
            className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 text-slate-200 px-3 lg:px-4 py-2 rounded-lg text-sm font-medium transition-colors border border-slate-700 cursor-pointer"
            title="Apertura de Caja"
          >
            <Lock className="w-4 h-4" /> <span className="hidden sm:inline">Apertura<span className="hidden lg:inline"> de Caja</span></span>
          </button>

          <button
            onClick={() => setModalCierreAbierto(true)}
            className="flex items-center gap-2 bg-amber-900 hover:bg-amber-800 text-amber-200 px-3 lg:px-4 py-2 rounded-lg text-sm font-medium transition-colors border border-amber-700 cursor-pointer"
            title="Cierre de Caja"
          >
            <Lock className="w-4 h-4" /> <span className="hidden sm:inline">Cierre<span className="hidden lg:inline"> de Caja</span></span>
          </button>

          {onLogout && (
            <button
              onClick={onLogout}
              className="hidden lg:flex items-center gap-2 bg-red-950 hover:bg-red-900 text-red-200 px-4 py-2 rounded-lg text-sm font-medium transition-colors border border-red-800 cursor-pointer"
              title="Cerrar turno y salir del sistema"
            >
              <LogOut className="w-4 h-4" /> Salir
            </button>
          )}
        </div>
      </header>

      {/* CONTENIDO PRINCIPAL: en el teléfono, una columna con la barra de cobro abajo */}
      <div className="flex flex-col lg:flex-row flex-1 min-h-0">
        
        {/* ESCANER OCULTO */}
        <ScannerInput onScan={handleProductScanned} />
        
        {/* Área Izquierda: Carrito o Resultados de Búsqueda */}
        <div className="flex-1 min-h-0 flex flex-col p-3 lg:p-6">
          <div className="flex flex-wrap lg:flex-nowrap justify-between items-center gap-2 lg:gap-0 mb-3 lg:mb-4">
            <h2 className="hidden lg:flex text-2xl font-bold text-slate-800 items-center gap-2 whitespace-nowrap">
              <ShoppingCart className="w-6 h-6 text-slate-600" />
              {busqueda ? "Resultados de Búsqueda" : "Detalle de Venta"}
            </h2>
            
            {/* BARRA DE BÚSQUEDA EN TIEMPO REAL */}
            <div className="relative w-full lg:w-auto lg:flex-1 lg:max-w-md lg:mx-6 order-first lg:order-none">
              <div className="relative">
                <input 
                  type="text" 
                  placeholder="Buscar por nombre, marca, tipo o color..."
                  value={busqueda}
                  onChange={(e) => setBusqueda(e.target.value)}
                  className="w-full pl-10 pr-10 py-2.5 lg:py-2 bg-white border border-slate-300 rounded-lg focus:ring-2 focus:ring-slate-900 outline-none shadow-sm text-base lg:text-sm"
                />
                <Search className="w-5 h-5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                {busqueda && (
                  <button 
                    onClick={() => setBusqueda("")}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs font-bold bg-slate-100 rounded-full w-6 h-6 flex items-center justify-center"
                    aria-label="Limpiar búsqueda"
                  >
                    ✕
                  </button>
                )}
              </div>
            </div>

            {/* ACCESO RÁPIDO: productos que no se pueden escanear */}
            <div className="flex gap-2 lg:mr-4 flex-1 lg:flex-none">
              <button onClick={() => setCamaraAbierta(true)} title="Escanear con la cámara" aria-label="Escanear con la cámara"
                className="px-3 py-2 bg-slate-900 text-white hover:bg-slate-700 rounded-lg font-bold text-sm transition-colors cursor-pointer flex items-center gap-2">
                <IconoCamara className="w-5 h-5" /> <span className="hidden sm:inline lg:hidden xl:inline">Escanear</span>
              </button>
              {[{ clave: 'caps', nombre: 'Caps' }, { clave: 'puntas', nombre: 'Puntas' }]
                .map(g => accesosRapidos.find(a => a.clave === g.clave) || g)
                .map(g => (
                  <button key={g.clave} onClick={() => abrirAccesoRapido(g.clave)} disabled={cargandoAcceso !== null}
                    className="flex-1 lg:flex-none px-4 py-2 bg-white border-2 border-slate-900 text-slate-900 hover:bg-slate-900 hover:text-white rounded-lg font-bold text-sm transition-colors disabled:opacity-60 cursor-pointer">
                    {cargandoAcceso === g.clave ? 'Cargando...' : g.nombre}
                  </button>
                ))}
            </div>

            <button
              onClick={handleCancelarVenta}
              disabled={cart.length === 0}
              className="flex items-center gap-2 bg-red-50 hover:bg-red-100 text-red-600 px-3 lg:px-4 py-2 rounded-lg text-sm font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer whitespace-nowrap"
              title="Cancelar venta"
            >
              <XCircle className="w-5 h-5" /> <span className="hidden sm:inline">Cancelar Venta</span>
            </button>
          </div>

          {/* CONTENEDOR CENTRAL INTELIGENTE */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 flex-1 min-h-0 flex flex-col overflow-hidden">
            
            {/* CASO A: EL USUARIO ESTÁ ESCRIBIENDO EN EL BUSCADOR */}
            {busqueda ? (
              <div className="flex-1 overflow-y-auto p-3 lg:p-4">
                {buscando ? (
                  <div className="h-full flex items-center justify-center text-slate-400">
                    <p className="animate-pulse text-sm font-medium">Buscando en el catálogo de Shopify...</p>
                  </div>
                ) : resultadosBusqueda.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-gray-400 space-y-2">
                    <Package className="w-12 h-12 opacity-20" />
                    <p className="text-sm text-center">No se encontraron productos con "{busqueda}"</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 lg:gap-3">
                    {resultadosBusqueda.map((prod) => (
                      <div
                        key={prod.id_shopify}
                        onClick={() => agregarAlCarrito(prod)}
                        className="bg-white border border-slate-200 hover:border-slate-900 hover:shadow-md active:bg-slate-50 rounded-xl p-3 lg:p-4 cursor-pointer transition-all flex flex-col justify-between group"
                      >
                        <div>
                          <p className="font-bold text-slate-800 text-sm line-clamp-2 group-hover:text-slate-900">
                            {prod.nombre}
                          </p>
                          <p className="text-xs text-slate-500 mt-1">{[prod.proveedor, prod.tipo].filter(Boolean).join(' · ') || `SKU: ${prod.sku || "N/A"}`}</p>
                        </div>
                        <div className="flex justify-between items-center mt-3 lg:mt-4 pt-2 lg:pt-3 border-t border-slate-100">
                          <span className="text-xs font-semibold text-emerald-600 bg-emerald-50 px-2 py-1 rounded">
                            Stock: {prod.stock_disponible}
                          </span>
                          <span className="font-black text-slate-900 text-base">
                            ${prod.precio.toLocaleString('es-CL')}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              /* CASO B: VISTA NORMAL DE CARRITO */
              <>
                <div className="hidden md:grid grid-cols-12 gap-4 p-4 border-b bg-slate-50 text-slate-600 font-semibold text-sm uppercase">
                  <div className="col-span-5">Producto</div>
                  <div className="col-span-3 text-center">Cantidad</div>
                  <div className="col-span-2 text-right">Precio</div>
                  <div className="col-span-2 text-center">Acción</div>
                </div>
                
                <div className="flex-1 overflow-y-auto p-2">
                  {carritoProcesado.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-gray-400 space-y-4 p-4">
                      <ShoppingCart className="w-16 h-16 opacity-20" />
                      <p className="text-base lg:text-lg text-center">Escanea un código de barras o busca arriba un producto...</p>
                    </div>
                  ) : (
                    <ul className="space-y-2">
                      {carritoProcesado.map((item, index) => {
                        const tieneDescuento = item.precioFinalLinea < item.precioOriginalLinea;

                        return (
                          // Teléfono: tarjeta (nombre y precio arriba, cantidad y eliminar abajo). Escritorio: fila de tabla
                          <li key={index} className={`grid grid-cols-[1fr_auto] md:grid-cols-12 gap-x-3 gap-y-2 md:gap-4 items-center p-3 bg-white rounded-lg border transition-all group ${tieneDescuento ? 'border-emerald-300 bg-emerald-50/30' : 'border-gray-100 hover:border-blue-100 hover:shadow-sm'}`}>
                            
                            <div className="md:col-span-5 min-w-0">
                              <p className="font-bold text-slate-800 line-clamp-2 leading-tight">{item.nombre}</p>
                              <p className="text-xs text-slate-500 mt-1 truncate">SKU: {item.sku || item.codigo_barras}</p>
                            </div>
                            
                            <div className="row-start-2 md:row-start-auto md:col-span-3 flex items-center md:justify-center gap-3">
                              <button 
                                onClick={(e) => {
                                  handleDisminuirCantidad(item.id_shopify);
                                  e.currentTarget.blur(); // <-- Suelta el foco del botón
                                }}
                                className="p-2 md:p-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-md transition-colors cursor-pointer"
                                aria-label="Quitar una unidad"
                              >
                                <Minus className="w-4 h-4" />
                              </button>
                              <span className="font-bold text-lg w-8 text-center text-slate-800">{item.cantidad}</span>
                              <button 
                                onClick={(e) => {
                                  handleAumentarCantidad(item.id_shopify);
                                  e.currentTarget.blur(); // <-- Suelta el foco del botón
                                }}
                                className="p-2 md:p-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-md transition-colors cursor-pointer"
                                aria-label="Agregar una unidad"
                              >
                                <Plus className="w-4 h-4" />
                              </button>
                            </div>

                            {/* PRECIO ACTUALIZADO CON LOGICA DE PROMOS MIX & MATCH */}
                            <div className="row-start-1 col-start-2 md:row-start-auto md:col-start-auto md:col-span-2 text-right flex flex-col items-end justify-center">
                              {tieneDescuento && (
                                <span className="text-xs line-through text-slate-400">
                                  ${item.precioOriginalLinea.toLocaleString('es-CL')}
                                </span>
                              )}
                              <span className={`font-bold text-lg ${tieneDescuento ? 'text-emerald-600' : 'text-slate-800'}`}>
                                ${item.precioFinalLinea.toLocaleString('es-CL')}
                              </span>
                              {tieneDescuento && (
                                <span className="text-[10px] font-bold text-white bg-emerald-500 px-1.5 py-0.5 rounded mt-1 text-center leading-none">
                                  {item.promoAplicada}
                                </span>
                              )}
                            </div>

                            <div className="row-start-2 col-start-2 md:row-start-auto md:col-start-auto md:col-span-2 flex justify-end md:justify-center">
                              <button 
                                onClick={(e) => {
                                  handleEliminarProducto(item.id_shopify);
                                  e.currentTarget.blur(); // <-- Suelta el foco del botón
                                }}
                                // En el teléfono no hay "hover": el botón siempre se ve
                                className="p-2 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors lg:opacity-0 lg:group-hover:opacity-100 cursor-pointer"
                                title="Eliminar producto"
                                aria-label="Eliminar producto"
                              >
                                <Trash2 className="w-5 h-5" />
                              </button>
                            </div>

                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              </>
            )}

          </div>
        </div>

        {/* TELÉFONO/TABLET: barra de cobro fija abajo */}
        <div className="lg:hidden bg-white border-t border-gray-200 shadow-[0_-4px_12px_rgba(0,0,0,0.06)] p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <div className="flex items-end justify-between mb-2">
            <span className="text-xs font-bold uppercase text-slate-500">
              Total{unidades > 0 && ` · ${unidades} ${unidades === 1 ? 'unidad' : 'unidades'}`}
            </span>
            <span className="text-3xl font-black text-slate-900 tracking-tight">${totalGeneral.toLocaleString('es-CL')}</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => abrirPago('TARJETA_TUU')}
              disabled={cart.length === 0}
              className="bg-slate-900 disabled:opacity-50 text-white py-3.5 rounded-xl font-bold flex items-center justify-center gap-2 cursor-pointer"
            >
              <CreditCard className="w-5 h-5" /> Tarjeta
            </button>
            <button
              onClick={() => abrirPago('EFECTIVO')}
              disabled={cart.length === 0}
              className="border-2 border-emerald-500 disabled:opacity-50 text-emerald-700 py-3 rounded-xl font-bold flex items-center justify-center gap-2 cursor-pointer"
            >
              <Banknote className="w-5 h-5" /> Efectivo / Transf.
            </button>
          </div>
        </div>

        {/* ESCRITORIO: Panel de Cobro lateral */}
        <div className="hidden lg:flex w-[400px] bg-white border-l border-gray-200 shadow-2xl flex-col relative z-20">
          <div className="p-8 flex-1 flex flex-col">
            
            <div className="mb-10">
              <h3 className="text-slate-500 text-sm font-bold uppercase tracking-wider mb-2">Total a Pagar</h3>
              <div className="text-6xl font-black text-slate-900 tracking-tighter">
                ${totalGeneral.toLocaleString('es-CL')}
              </div>
              <div className="h-1 w-20 bg-emerald-500 mt-6 rounded-full"></div>
            </div>
            
            <div className="mt-auto space-y-4">
              <p className="text-xs text-slate-400 font-medium uppercase text-center mb-4">Seleccione Método de Pago</p>
              
              <button 
                onClick={() => abrirPago('TARJETA_TUU')}
                disabled={cart.length === 0}
                className="w-full bg-slate-900 hover:bg-slate-800 disabled:opacity-50 disabled:hover:bg-slate-900 text-white p-5 rounded-xl font-bold flex items-center justify-center gap-3 transition-all shadow-lg hover:shadow-xl cursor-pointer"
              >
                <CreditCard className="w-6 h-6" />
                Pago con Tarjeta TUU
              </button>
              
              <button 
                onClick={() => abrirPago('EFECTIVO')}
                disabled={cart.length === 0}
                className="w-full border-2 border-emerald-500 hover:bg-emerald-50 disabled:opacity-50 text-emerald-700 p-5 rounded-xl font-bold flex items-center justify-center gap-3 transition-all cursor-pointer"
              >
                <Banknote className="w-6 h-6" />
                Efectivo / Transferencia
              </button>
            </div>
            
          </div>
        </div>
      </div>

      {/* Modales */}
      {modalPagoAbierto && (
        <ModalPago
          carrito={carritoProcesado}
          totalCompra={totalGeneral}
          metodoInicial={metodoInicial}
          onClose={() => setModalPagoAbierto(false)}
          onVentaExitosa={handleVentaExitosa}
        />
      )}

      {camaraAbierta && (
        <ModalEscanerCamara onCodigo={buscarYAgregar} onClose={() => setCamaraAbierta(false)} />
      )}

      {grupoAbierto && (
        <ModalAccesoRapido
          grupo={grupoAbierto}
          enCarrito={cantidadesEnCarrito}
          onAgregar={agregarAlCarrito}
          onClose={() => setGrupoAbierto(null)}
        />
      )}

      {comprobanteVentaId && (
        <ModalComprobante
          ventaId={comprobanteVentaId}
          textoCerrar="Nueva venta"
          onClose={() => setComprobanteVentaId(null)}
        />
      )}

      {modalAperturaAbierto && (
        <ModalAbrirCaja
          onSesionAbierta={() => setModalAperturaAbierto(false)}
        />
      )}

      {modalCierreAbierto && (
        <ModalCerrarCaja
          onCajaCerrada={() => {}}
          onClose={() => setModalCierreAbierto(false)}
        />
      )}
    </div>
  );
}