import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Las llamadas a /api se reenvían a Django: la caja funciona igual abierta en
    // el PC, desde el teléfono por wifi (npm run dev -- --host) o por un túnel https.
    proxy: {
      '/api': { target: 'http://127.0.0.1:8000', changeOrigin: true },
    },
    // Túneles https para probar en el teléfono (cámara): Cloudflare Tunnel
    allowedHosts: ['.trycloudflare.com'],
  },
})
