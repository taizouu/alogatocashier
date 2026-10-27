import React, { useState } from 'react';
import { documentosService } from '../../services/api';
import { Search } from 'lucide-react';

const CAMPOS = [
    { clave: 'razon_social', nombre: 'Razón social', ancho: 'md:col-span-2' },
    { clave: 'giro', nombre: 'Giro', ancho: 'md:col-span-2' },
    { clave: 'direccion', nombre: 'Dirección', ancho: '' },
    { clave: 'comuna', nombre: 'Comuna', ancho: '' },
];

export const documentoVacio = () => ({
    tipo: 'BOLETA',
    email: '',
    receptor: { rut: '', razon_social: '', giro: '', direccion: '', comuna: '' },
});

/**
 * Elige el documento tributario de la venta: boleta (con correo opcional) o
 * factura con los datos del cliente. Con tarjeta, la boleta la emite el POS TUU.
 */
export default function SelectorDocumento({ documento, onChange, metodoPago, ambiente }) {
    const [buscando, setBuscando] = useState(false);
    const [aviso, setAviso] = useState('');
    const conTarjeta = metodoPago === 'TARJETA_TUU';

    const cambiar = (cambios) => onChange({ ...documento, ...cambios });
    const cambiarReceptor = (clave, valor) => cambiar({ receptor: { ...documento.receptor, [clave]: valor } });

    const buscarRut = async () => {
        setAviso('');
        if (!documento.receptor.rut.trim()) return setAviso('Escribe el RUT del cliente.');
        setBuscando(true);
        try {
            const datos = await documentosService.contribuyente(documento.receptor.rut);
            cambiar({
                receptor: { ...documento.receptor, ...Object.fromEntries(
                    ['rut', 'razon_social', 'giro', 'direccion', 'comuna'].map(c => [c, datos[c] || documento.receptor[c] || ''])
                ) },
                email: documento.email || datos.email || '',
            });
        } catch (e) {
            setAviso(e.response?.data?.error || 'No se pudo consultar el RUT. Completa los datos a mano.');
        } finally {
            setBuscando(false);
        }
    };

    if (conTarjeta) {
        return (
            <div className="mb-4 p-3 rounded-lg bg-slate-50 border border-slate-200 text-sm text-slate-600">
                <strong>Boleta:</strong> la emite el POS TUU al cobrar con tarjeta.
                Si el cliente necesita factura, emítela desde el POS.
            </div>
        );
    }

    const inputClase = 'w-full p-2 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500';

    return (
        <div className="mb-4 p-3 rounded-lg bg-slate-50 border border-slate-200 space-y-3">
            <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-gray-700">Documento</span>
                {ambiente === 'dev' && (
                    <span className="text-[11px] font-bold bg-amber-100 text-amber-800 px-2 py-0.5 rounded">PRUEBAS · no llega al SII</span>
                )}
            </div>
            <div className="grid grid-cols-2 gap-2">
                {[['BOLETA', 'Boleta'], ['FACTURA', 'Factura']].map(([valor, nombre]) => (
                    <button key={valor} type="button" onClick={() => cambiar({ tipo: valor })}
                        className={`p-2 rounded font-medium border cursor-pointer ${
                            documento.tipo === valor ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-100'
                        }`}>
                        {nombre}
                    </button>
                ))}
            </div>

            {documento.tipo === 'FACTURA' && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    <div className="md:col-span-2 flex gap-2">
                        <input value={documento.receptor.rut} onChange={e => cambiarReceptor('rut', e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); buscarRut(); } }}
                            placeholder="RUT del cliente (ej: 76.123.456-7)" className={inputClase} />
                        <button type="button" onClick={buscarRut} disabled={buscando}
                            className="px-3 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1 cursor-pointer">
                            <Search className="w-4 h-4" /> {buscando ? '...' : 'Buscar'}
                        </button>
                    </div>
                    {CAMPOS.map(c => (
                        <input key={c.clave} value={documento.receptor[c.clave]} placeholder={c.nombre}
                            onChange={e => cambiarReceptor(c.clave, e.target.value)}
                            className={`${inputClase} ${c.ancho}`} />
                    ))}
                </div>
            )}

            <input type="email" value={documento.email} onChange={e => cambiar({ email: e.target.value })}
                placeholder={documento.tipo === 'FACTURA' ? 'Correo del cliente (opcional)' : 'Enviar boleta al correo (opcional)'}
                className={inputClase} />
            {aviso && <p className="text-xs text-amber-700">{aviso}</p>}
        </div>
    );
}
