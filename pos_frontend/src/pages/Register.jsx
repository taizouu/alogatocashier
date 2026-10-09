import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useOutletContext } from 'react-router-dom';
import { ShoppingCart, CreditCard, Banknote, Lock, Plus, Minus, Trash2, XCircle, Search, LogOut, Package } from 'lucide-react';
import ScannerInput from '../components/POS/ScannerInput';
import { posService } from '../services/api';
import ModalPago from '../components/POS/ModalPago';
import ModalAbrirCaja from '../components/POS/ModalAbrirCaja';
import ModalCerrarCaja from '../components/POS/ModalCerrarCaja';

export default function Register() {
  const { onLogout } = useOutletContext();
  const [busqueda, setBusqueda] = useState("");
  const [resultadosBusqueda, setResultadosBusqueda] = useState([]);
  const [buscando, setBuscando] = useState(false);
  const [cart, setCart] = useState([]);
  const [modalPagoAbierto, setModalPagoAbierto] = useState(false);
  const [modalAperturaAbierto, setModalAperturaAbierto] = useState(false);
  const [modalCierreAbierto, setModalCierreAbierto] = useState(false);
  
  const [promociones, setPromociones] = useState([]);

  useEffect(() => {
      const cargarPromos = async () => {
          try {
              const promosActivas = await posService.obtenerPromocionesActivas();
              setPromociones(promosActivas);
          } catch (error) {
              console.error("Error cargando promociones:", error);
          }
      };
      cargarPromos();
  }, []);

  const { carritoProcesado, totalGeneral } = useMemo(() => {
      let lineas = cart.map(item => ({
          ...item,
          precioOriginalLinea: Math.round(item.precio * item.cantidad),
          precioFinalLinea: Math.round(item.precio * item.cantidad),
          promoAplicada: null
      }));

      promociones.forEach(promo => {
          const itemsAptos = lineas.filter(item => {
              if (item.promoAplicada) return false; 

              const sku = item.sku || item.codigo_barras || '';
              const vendor = item.vendor || item.proveedor || ''; 
              const tipo = item.product_type || item.tipo || '';

              if (promo.alcance_tipo === 'SKU') return sku === promo.alcance_valor;
              if (promo.alcance_tipo === 'PROVEEDOR') return vendor.toUpperCase() === promo.alcance_valor.toUpperCase();
              if (promo.alcance_tipo === 'TIPO') return tipo.toUpperCase() === promo.alcance_valor.toUpperCase();
              
              return false;
          });

          if (itemsAptos.length === 0) return;

          const unidadesAptas = itemsAptos.reduce((acc, item) => acc + item.cantidad, 0);
          const req = Number(promo.cantidad_requerida);

          if (unidadesAptas >= req) {
              const costoOriginalGrupo = itemsAptos.reduce((acc, item) => acc + item.precioOriginalLinea, 0);
              const precioPromedioNormal = costoOriginalGrupo / unidadesAptas;
              let costoPromoGrupo = 0;

              const paquetes = Math.floor(unidadesAptas / req);
              const sueltas = unidadesAptas % req;

              if (promo.tipo_promocion === 'VOLUMEN') {
                  costoPromoGrupo = (paquetes * Number(promo.precio_promocional)) + (sueltas * precioPromedioNormal);
              } else if (promo.tipo_promocion === 'N_X_M') {
                  costoPromoGrupo = (paquetes * Number(promo.cantidad_pagada) * precioPromedioNormal) + (sueltas * precioPromedioNormal);
              } else if (promo.tipo_promocion === 'POR_MAYOR') {
                  costoPromoGrupo = unidadesAptas * Number(promo.precio_promocional);
              }

              // Redondeamos el costo total del grupo para estar seguros
              costoPromoGrupo = Math.round(costoPromoGrupo);
              const factorDescuento = costoOriginalGrupo > 0 ? (costoPromoGrupo / costoOriginalGrupo) : 1;

              let acumuladoRepartido = 0; // Memoria para no perder ni 1 peso

              itemsAptos.forEach((item, index) => {
                  if (index === itemsAptos.length - 1) {
                      // AL ÚLTIMO ITEM LE DAMOS EL RESIDUO EXACTO PARA QUE CUADRE
                      item.precioFinalLinea = costoPromoGrupo - acumuladoRepartido;
                  } else {
                      // A LOS PRIMEROS ITEMS LOS REDONDEAMOS NORMALMENTE
                      const precioCalculado = Math.round(item.precioOriginalLinea * factorDescuento);
                      item.precioFinalLinea = precioCalculado;
                      acumuladoRepartido += precioCalculado;
                  }
                  item.promoAplicada = promo.nombre; 
              });
          }
      });

      // Aseguramos que la sumatoria total también sea un número entero puro
      const sumatoria = Math.round(lineas.reduce((acc, item) => acc + item.precioFinalLinea, 0));

      return { carritoProcesado: lineas, totalGeneral: sumatoria };
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

    // Tu lógica original intacta:
    try {
      const productoReal = await posService.buscarProducto(codigoDeBarras);
      agregarAlCarrito(productoReal);
    } catch (error) {
      console.error("Error al buscar producto:", error);
      alert("Producto no encontrado en el catálogo por código de barras.");
    }
  };

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

  const handleVentaExitosa = () => {
    setCart([]);
    setModalPagoAbierto(false);
  };

  return (
    <div className="flex flex-col h-screen bg-gray-50 font-sans">
      
      {/* HEADER ELEGANTE CON LOGO */}
      <header className="bg-slate-900 text-white py-3 px-6 shadow-md flex justify-between items-center z-10">
        <div className="flex items-center gap-4">
          <img 
            src="/logo.png" 
            alt="Logo AloCat" 
            className="h-10 w-auto object-contain bg-white rounded-md p-1"
            onError={(e) => { e.target.style.display = 'none'; }} 
          />
          <div>
            <h1 className="text-xl font-bold tracking-wide">CAJA Y REGISTROS ALOGATO GRAFFSTORE</h1>
            <p className="text-slate-400 text-xs uppercase tracking-widest">Terminal de Venta POS</p>
          </div>
        </div>
        
        <div className="flex gap-3">
          <button
            onClick={() => setModalAperturaAbierto(true)}
            className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 text-slate-200 px-4 py-2 rounded-lg text-sm font-medium transition-colors border border-slate-700 cursor-pointer"
          >
            <Lock className="w-4 h-4" /> Apertura de Caja
          </button>

          <button
            onClick={() => setModalCierreAbierto(true)}
            className="flex items-center gap-2 bg-amber-900 hover:bg-amber-800 text-amber-200 px-4 py-2 rounded-lg text-sm font-medium transition-colors border border-amber-700 cursor-pointer"
          >
            <Lock className="w-4 h-4" /> Cierre de Caja
          </button>

          {onLogout && (
            <button
              onClick={onLogout}
              className="flex items-center gap-2 bg-red-950 hover:bg-red-900 text-red-200 px-4 py-2 rounded-lg text-sm font-medium transition-colors border border-red-800 cursor-pointer"
              title="Cerrar turno y salir del sistema"
            >
              <LogOut className="w-4 h-4" /> Salir
            </button>
          )}
        </div>
      </header>

      {/* CONTENIDO PRINCIPAL */}
      <div className="flex flex-1 overflow-hidden">
        
        {/* ESCANER OCULTO */}
        <ScannerInput onScan={handleProductScanned} />
        
        {/* Área Izquierda: Carrito o Resultados de Búsqueda */}
        <div className="flex-1 flex flex-col p-6">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
              <ShoppingCart className="w-6 h-6 text-slate-600" />
              {busqueda ? "Resultados de Búsqueda" : "Detalle de Venta"}
            </h2>
            
            {/* BARRA DE BÚSQUEDA EN TIEMPO REAL */}
            <div className="relative flex-1 max-w-md mx-6">
              <div className="relative">
                <input 
                  type="text" 
                  placeholder="Escribe el nombre o color (ej: Rojo Madrid)..."
                  value={busqueda}
                  onChange={(e) => setBusqueda(e.target.value)}
                  className="w-full pl-10 pr-10 py-2 bg-white border border-slate-300 rounded-lg focus:ring-2 focus:ring-slate-900 outline-none shadow-sm text-sm"
                />
                <Search className="w-5 h-5 text-slate-400 absolute left-3 top-2.5" />
                {busqueda && (
                  <button 
                    onClick={() => setBusqueda("")}
                    className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600 text-xs font-bold bg-slate-100 rounded-full w-5 h-5 flex items-center justify-center"
                  >
                    ✕
                  </button>
                )}
              </div>
            </div>

            <button
              onClick={handleCancelarVenta}
              disabled={cart.length === 0}
              className="flex items-center gap-2 bg-red-50 hover:bg-red-100 text-red-600 px-4 py-2 rounded-lg text-sm font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              <XCircle className="w-5 h-5" /> Cancelar Venta
            </button>
          </div>

          {/* CONTENEDOR CENTRAL INTELIGENTE */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 flex-1 flex flex-col overflow-hidden">
            
            {/* CASO A: EL USUARIO ESTÁ ESCRIBIENDO EN EL BUSCADOR */}
            {busqueda ? (
              <div className="flex-1 overflow-y-auto p-4">
                {buscando ? (
                  <div className="h-full flex items-center justify-center text-slate-400">
                    <p className="animate-pulse text-sm font-medium">Buscando en el catálogo de Shopify...</p>
                  </div>
                ) : resultadosBusqueda.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-gray-400 space-y-2">
                    <Package className="w-12 h-12 opacity-20" />
                    <p className="text-sm">No se encontraron productos con "{busqueda}"</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    {resultadosBusqueda.map((prod) => (
                      <div
                        key={prod.id_shopify}
                        onClick={() => agregarAlCarrito(prod)}
                        className="bg-white border border-slate-200 hover:border-slate-900 hover:shadow-md rounded-xl p-4 cursor-pointer transition-all flex flex-col justify-between group"
                      >
                        <div>
                          <p className="font-bold text-slate-800 text-sm line-clamp-2 group-hover:text-slate-900">
                            {prod.nombre}
                          </p>
                          <p className="text-xs text-slate-500 mt-1">SKU: {prod.sku || "N/A"}</p>
                        </div>
                        <div className="flex justify-between items-center mt-4 pt-3 border-t border-slate-100">
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
                <div className="grid grid-cols-12 gap-4 p-4 border-b bg-slate-50 text-slate-600 font-semibold text-sm uppercase">
                  <div className="col-span-5">Producto</div>
                  <div className="col-span-3 text-center">Cantidad</div>
                  <div className="col-span-2 text-right">Precio</div>
                  <div className="col-span-2 text-center">Acción</div>
                </div>
                
                <div className="flex-1 overflow-y-auto p-2">
                  {carritoProcesado.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-gray-400 space-y-4">
                      <ShoppingCart className="w-16 h-16 opacity-20" />
                      <p className="text-lg">Escanea un código de barras o escribe arriba para buscar un color...</p>
                    </div>
                  ) : (
                    <ul className="space-y-2">
                      {carritoProcesado.map((item, index) => {
                        const tieneDescuento = item.precioFinalLinea < item.precioOriginalLinea;

                        return (
                          <li key={index} className={`grid grid-cols-12 gap-4 items-center p-3 bg-white rounded-lg border transition-all group ${tieneDescuento ? 'border-emerald-300 bg-emerald-50/30' : 'border-gray-100 hover:border-blue-100 hover:shadow-sm'}`}>
                            
                            <div className="col-span-5">
                              <p className="font-bold text-slate-800 line-clamp-2 leading-tight">{item.nombre}</p>
                              <p className="text-xs text-slate-500 mt-1">SKU: {item.sku || item.codigo_barras}</p>
                            </div>
                            
                            <div className="col-span-3 flex items-center justify-center gap-3">
                              <button 
                                onClick={(e) => {
                                  handleDisminuirCantidad(item.id_shopify);
                                  e.currentTarget.blur(); // <-- Suelta el foco del botón
                                }}
                                className="p-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-md transition-colors cursor-pointer"
                              >
                                <Minus className="w-4 h-4" />
                              </button>
                              <span className="font-bold text-lg w-8 text-center text-slate-800">{item.cantidad}</span>
                              <button 
                                onClick={(e) => {
                                  handleAumentarCantidad(item.id_shopify);
                                  e.currentTarget.blur(); // <-- Suelta el foco del botón
                                }}
                                className="p-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-md transition-colors cursor-pointer"
                              >
                                <Plus className="w-4 h-4" />
                              </button>
                            </div>

                            {/* PRECIO ACTUALIZADO CON LOGICA DE PROMOS MIX & MATCH */}
                            <div className="col-span-2 text-right flex flex-col items-end justify-center">
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

                            <div className="col-span-2 flex justify-center">
                              <button 
                                onClick={(e) => {
                                  handleEliminarProducto(item.id_shopify);
                                  e.currentTarget.blur(); // <-- Suelta el foco del botón
                                }}
                                className="p-2 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors opacity-0 group-hover:opacity-100 cursor-pointer"
                                title="Eliminar producto"
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

        {/* Área Derecha: Panel de Cobro Elegante */}
        <div className="w-[400px] bg-white border-l border-gray-200 shadow-2xl flex flex-col relative z-20">
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
                onClick={() => cart.length > 0 && setModalPagoAbierto(true)}
                disabled={cart.length === 0}
                className="w-full bg-slate-900 hover:bg-slate-800 disabled:opacity-50 disabled:hover:bg-slate-900 text-white p-5 rounded-xl font-bold flex items-center justify-center gap-3 transition-all shadow-lg hover:shadow-xl cursor-pointer"
              >
                <CreditCard className="w-6 h-6" />
                Pago con Tarjeta TUU
              </button>
              
              <button 
                onClick={() => cart.length > 0 && setModalPagoAbierto(true)}
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
          onClose={() => setModalPagoAbierto(false)}
          onVentaExitosa={handleVentaExitosa}
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