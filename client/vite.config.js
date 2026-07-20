import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  server: { host: '0.0.0.0', port: 8080 },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        nws:  resolve(__dirname, 'nws.html'),
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
  },
});
