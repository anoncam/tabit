import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    target: 'es2020',
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor': ['react', 'react-dom'],
          'tensorflow': ['@tensorflow/tfjs'],
          'basic-pitch': ['@spotify/basic-pitch']
        }
      }
    }
  },
  optimizeDeps: {
    exclude: ['@tensorflow/tfjs', '@spotify/basic-pitch']
  }
})
