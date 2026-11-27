import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    sourcemap: false,
    target: 'es2022',
    // Keine Inline-Assets -> strikte CSP ohne data:-Skripte
    assetsInlineLimit: 0,
  },
  server: {
    port: 5173,
    // Lokale Entwicklung: API und Keycloak über den Reverse Proxy
    proxy: {
      '/api': { target: 'https://localhost:8443', secure: false, changeOrigin: false },
      '/auth': { target: 'https://localhost:8443', secure: false, changeOrigin: false },
    },
  },
});
