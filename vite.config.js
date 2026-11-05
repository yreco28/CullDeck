import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'chrome130',
    assetsInlineLimit: 0
  },
  server: {
    port: 5199,
    strictPort: true
  }
})
