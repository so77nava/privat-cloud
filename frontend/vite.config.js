import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Im Dev-Modus laufen API-Aufrufe über den Vite-Proxy → gleiche Origin, Cookies funktionieren.
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
});
