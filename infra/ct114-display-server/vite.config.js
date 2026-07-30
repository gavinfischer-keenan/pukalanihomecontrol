import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'http://192.168.1.114:3000',
        changeOrigin: true
      },
      '/proxy': {
        target: 'http://192.168.1.114:3000',
        changeOrigin: true
      },
      '/ws': {
        target: 'ws://192.168.1.114:3000',
        ws: true
      }
    }
  }
})
