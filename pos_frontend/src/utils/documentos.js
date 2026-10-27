import { documentosService } from '../services/api';

/**
 * Abre el PDF de una boleta o factura en una pestaña nueva.
 * La pestaña se abre antes de descargar (si se abre después de esperar la
 * descarga, el navegador la bloquea como ventana emergente).
 */
export async function abrirPdfDocumento(id) {
    const ventana = window.open('', '_blank');
    try {
        const blob = await documentosService.pdf(id);
        const url = URL.createObjectURL(blob);
        if (ventana) {
            ventana.location.href = url;
        } else {
            // Ventanas emergentes bloqueadas: se descarga el archivo
            const enlace = document.createElement('a');
            enlace.href = url;
            enlace.download = `documento-${id}.pdf`;
            enlace.click();
        }
        setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e) {
        if (ventana) ventana.close();
        let mensaje = 'No se pudo obtener el PDF.';
        // El error viene como blob: hay que leerlo para mostrar el motivo
        try { mensaje = JSON.parse(await e.response.data.text()).error || mensaje; } catch { /* sin detalle */ }
        alert(mensaje);
    }
}

export const ESTILO_ESTADO = {
    EMITIDO: 'bg-green-100 text-green-800',
    PENDIENTE: 'bg-blue-100 text-blue-800',
    ERROR: 'bg-red-100 text-red-700',
};
