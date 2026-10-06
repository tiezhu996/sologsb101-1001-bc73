import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  server: {
    port: 22801,
    host: true
  },
  preview: {
    port: 22801,
    host: true
  },
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 1500
  }
})
