import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      // Dev server (dev-server.mjs) menyediakan API yang sama dengan IPC Electron,
      // sehingga UI bisa diuji penuh di browser biasa.
      '/api': 'http://localhost:5174',
      '/media': 'http://localhost:5174',
    },
  },
  optimizeDeps: {
    exclude: ['@huggingface/transformers', '@mediapipe/tasks-vision'],
  },
  build: {
    outDir: 'dist',
    target: 'es2022',
  },
});
