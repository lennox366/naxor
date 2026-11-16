import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',
  server: { port: 5173 },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // Inline the sql.js wasm (~688KB) as base64 so it loads reliably under file://
    assetsInlineLimit: 1024 * 1024,
  },
});
