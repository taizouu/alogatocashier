/**
 * Lectura de códigos de barras con la cámara (teléfono o webcam).
 *
 * 1. Si el navegador trae el lector nativo (BarcodeDetector: Chrome en Android),
 *    se usa ese: es rápido y no descarga nada.
 * 2. Si no (Safari en iPhone, Firefox), se carga ZXing desde un CDN la primera
 *    vez que se abre la cámara. Así no hay que instalar paquetes nuevos.
 *
 * La cámara solo funciona en páginas seguras: https:// o http://localhost.
 */

const FORMATOS_NATIVOS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf'];
const ZXING_URL = 'https://cdn.jsdelivr.net/npm/@zxing/browser@0.2.1/+esm';
const INTERVALO_NATIVO_MS = 120;

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
    video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
};

async function lectorNativo(video, onCodigo) {
    const soportados = await window.BarcodeDetector.getSupportedFormats();
    const formatos = FORMATOS_NATIVOS.filter(f => soportados.includes(f));
    if (!formatos.length) return null;
    const detector = new window.BarcodeDetector({ formats: formatos });

    const stream = await navigator.mediaDevices.getUserMedia(RESTRICCIONES);
    video.srcObject = stream;
    video.setAttribute('playsinline', '');
    video.muted = true;
    await video.play();

    let activo = true;
    let ocupado = false;
    const intervalo = setInterval(async () => {
        if (!activo || ocupado || video.readyState < 2) return;
        ocupado = true;
        try {
            const codigos = await detector.detect(video);
            if (activo && codigos.length) onCodigo(codigos[0].rawValue);
        } catch { /* cuadro ilegible: se intenta con el siguiente */ }
        ocupado = false;
    }, INTERVALO_NATIVO_MS);

    return {
        detener() {
            activo = false;
            clearInterval(intervalo);
            stream.getTracks().forEach(t => t.stop());
            video.srcObject = null;
        },
    };
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
            const nativo = await lectorNativo(video, onCodigo);
            if (nativo) return nativo;
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
