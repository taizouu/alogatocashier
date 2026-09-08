import { useEffect, useRef } from 'react';

export default function ScannerInput({ onScan }) {
  const barcodeBuffer = useRef('');
  const lastKeyTime = useRef(Date.now());

  useEffect(() => {
    const handleKeyDown = (e) => {
      const currentTime = Date.now();
      
      // 1. Si pasa mucho tiempo entre teclas (más de 50ms), asumimos que es un humano 
      // tecleando y limpiamos el buffer para no mezclar caracteres.
      if (currentTime - lastKeyTime.current > 50) {
        barcodeBuffer.current = '';
      }
      
      lastKeyTime.current = currentTime;

      // 2. Si la pistola envía el 'Enter', evaluamos si hay un código válido.
      if (e.key === 'Enter') {
        // Exigimos un mínimo de 4 caracteres para evitar falsos positivos
        if (barcodeBuffer.current.length > 3) {
          onScan(barcodeBuffer.current); // Enviamos el código al componente padre (Register)
        }
        barcodeBuffer.current = ''; // Vaciamos el buffer para la siguiente lectura
        return;
      }

      // 3. Si es un carácter normal (números/letras), lo acumulamos.
      // e.key.length === 1 evita capturar teclas como "Shift", "Control" o "Alt".
      if (e.key.length === 1) {
        barcodeBuffer.current += e.key;
      }
    };

    // Añadimos el "escuchador" a toda la ventana del navegador
    window.addEventListener('keydown', handleKeyDown);

    // Limpiamos el evento cuando el componente se desmonta para evitar fugas de memoria
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onScan]);

  // Este componente es puramente lógico, no renderiza ninguna interfaz visual
  return null;
}