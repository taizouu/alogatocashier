/**
 * Lectura de códigos de barras con la cámara (teléfono o webcam).
 *
 * 1. Lector nativo del navegador (BarcodeDetector: Chrome en Android): rápido.
 * 2. iPhone (Safari no trae lector nativo): el mismo lector, pero con ZXing-C++
 *    en WebAssembly (paquete barcode-detector), que se descarga del CDN la
 *    primera vez. Es bastante más rápido y certero que el lector anterior.
 * 3. Si eso no carga, ZXing en JavaScript como último recurso.
 *
 * Para leer mejor: se pide la cámara trasera en alta resolución, con enfoque
 * continuo donde se puede, y se analiza solo la franja central (donde está el
 * recuadro guía), que se ve más grande y se procesa más rápido.
 *
 * La cámara solo funciona en páginas seguras: https:// o http://localhost.
 */

const FORMATOS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf'];
const PONYFILL_URL = 'https://cdn.jsdelivr.net/npm/barcode-detector@3.2.3/dist/es/ponyfill.min.js';
const ZXING_URL = 'https://cdn.jsdelivr.net/npm/@zxing/browser@0.2.1/+esm';
const INTERVALO_MS = 100;
// Franja central del cuadro que se analiza (proporción del ancho y alto del video)
const FRANJA_ANCHO = 0.9;
const FRANJA_ALTO = 0.5;

export class ErrorCamara extends Error {}

export function camaraDisponible() {
    if (!window.isSecureContext) {
        return 'La cámara solo funciona si la caja se abre con https:// (o en este mismo PC con localhost).';
    }
    if (!navigator.mediaDevices?.getUserMedia) {
        return 'Este navegador no permite usar la cámara.';
    }
    return null;
}

function mensajeDeError(e) {
    if (e?.name === 'NotAllowedError') return 'No se dio permiso para usar la cámara. Actívalo en la configuración del navegador.';
    if (e?.name === 'NotFoundError' || e?.name === 'OverconstrainedError') return 'No se encontró una cámara en este equipo.';
    if (e?.name === 'NotReadableError') return 'La cámara está siendo usada por otra aplicación.';
    return e?.message || 'No se pudo abrir la cámara.';
}

const RESTRICCIONES = {
    audio: false,
    // Alta resolución: los códigos chicos de las latas se leen mejor
    video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
};

async function abrirCamara(video) {
    const stream = await navigator.mediaDevices.getUserMedia(RESTRICCIONES);
    const pista = stream.getVideoTracks()[0];
    // Enfoque continuo (Android; en iPhone el enfoque ya es automático)
    try {
        if (pista?.getCapabilities?.().focusMode?.includes('continuous')) {
            await pista.applyConstraints({ advanced: [{ focusMode: 'continuous' }] });
        }
    } catch { /* no soportado */ }
    video.srcObject = stream;
    video.setAttribute('playsinline', '');
    video.muted = true;
    await video.play();
    return stream;
}

/** Lector con la API BarcodeDetector (nativa o la de ZXing-C++ para iPhone). */
async function lectorDetector(video, onCodigo, ClaseDetector) {
    const soportados = await ClaseDetector.getSupportedFormats();
    const formatos = FORMATOS.filter(f => soportados.includes(f));
    if (!formatos.length) return null;
    const detector = new ClaseDetector({ formats: formatos });
    const stream = await abrirCamara(video);

    const lienzo = document.createElement('canvas');
    const ctx = lienzo.getContext('2d', { willReadFrequently: true });
    let activo = true;
    let ocupado = false;
    const intervalo = setInterval(async () => {
        if (!activo || ocupado || video.readyState < 2 || !video.videoWidth) return;
        ocupado = true;
        try {
            // Solo la franja central, donde el cajero apunta el recuadro
            const ancho = Math.round(video.videoWidth * FRANJA_ANCHO);
            const alto = Math.round(video.videoHeight * FRANJA_ALTO);
            if (lienzo.width !== ancho) lienzo.width = ancho;
            if (lienzo.height !== alto) lienzo.height = alto;
            ctx.drawImage(video, (video.videoWidth - ancho) / 2, (video.videoHeight - alto) / 2, ancho, alto,
                          0, 0, ancho, alto);
            let codigos = await detector.detect(lienzo);
            // Si en la franja no hay nada, se intenta con el cuadro completo cada tanto
            if (!codigos.length && Math.random() < 0.25) codigos = await detector.detect(video);
            if (activo && codigos.length) onCodigo(codigos[0].rawValue);
        } catch { /* cuadro ilegible: se intenta con el siguiente */ }
        ocupado = false;
    }, INTERVALO_MS);

    return {
        detener() {
            activo = false;
            clearInterval(intervalo);
            stream.getTracks().forEach(t => t.stop());
            video.srcObject = null;
        },
    };
}

async function cargarDetectorWasm() {
    try {
        const modulo = await import(/* @vite-ignore */ PONYFILL_URL);
        const Clase = modulo.BarcodeDetector;
        if (!Clase) return null;
        // El motor (.wasm) se descarga en la primera lectura: se prueba ahora con una
        // imagen vacía para saber si cargó, y si no, usar el lector de respaldo
        const prueba = document.createElement('canvas');
        prueba.width = prueba.height = 8;
        await new Clase({ formats: ['ean_13'] }).detect(prueba);
        return Clase;
    } catch {
        return null;
    }
}

async function lectorZxing(video, onCodigo) {
    let zxing;
    try {
        zxing = await import(/* @vite-ignore */ ZXING_URL);
    } catch {
        throw new ErrorCamara('No se pudo cargar el lector de códigos (revisa la conexión a internet).');
    }
    const lector = new zxing.BrowserMultiFormatReader(undefined, { delayBetweenScanAttempts: 120 });
    const controles = await lector.decodeFromConstraints(RESTRICCIONES, video, (resultado) => {
        if (resultado) onCodigo(resultado.getText());
    });
    return { detener: () => controles.stop() };
}

/**
 * Enciende la cámara en `video` y llama a onCodigo(texto) por cada código leído.
 * Devuelve { detener() }. Lanza ErrorCamara con un mensaje para mostrar.
 */
export async function iniciarLector(video, onCodigo) {
    const problema = camaraDisponible();
    if (problema) throw new ErrorCamara(problema);
    try {
        if ('BarcodeDetector' in window) {
            const nativo = await lectorDetector(video, onCodigo, window.BarcodeDetector);
            if (nativo) return nativo;
        }
        // iPhone y otros sin lector nativo: ZXing-C++ (WebAssembly)
        const DetectorWasm = await cargarDetectorWasm();
        if (DetectorWasm) {
            const wasm = await lectorDetector(video, onCodigo, DetectorWasm);
            if (wasm) return wasm;
        }
        return await lectorZxing(video, onCodigo);
    } catch (e) {
        if (e instanceof ErrorCamara) throw e;
        throw new ErrorCamara(mensajeDeError(e));
    }
}

/**
 * Variantes de un código para buscarlo: un mismo producto puede estar
 * guardado como UPC-A (12 dígitos) o EAN-13 (13 dígitos, con un 0 delante).
 */
export function variantesCodigo(codigo) {
    const limpio = String(codigo || '').trim();
    const variantes = [limpio];
    if (/^\d{12}$/.test(limpio)) variantes.push('0' + limpio);
    if (/^0\d{12}$/.test(limpio)) variantes.push(limpio.slice(1));
    return variantes;
}
