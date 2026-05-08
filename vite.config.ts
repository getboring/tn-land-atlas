import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'path'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  build: {
    // Bump the warning floor — our split chunks are bound to be ~400KB given
    // MapLibre's size, and the lazy boundary is the right answer, not further
    // splitting MapLibre itself.
    chunkSizeWarningLimit: 700,
    rolldownOptions: {
      output: {
        manualChunks: (id) => {
          if (id.includes('node_modules/maplibre-gl/')) return 'maplibre'
          if (id.includes('node_modules/maplibre-contour/')) return 'maplibre-contour'
          if (id.includes('node_modules/terra-draw')) return 'terra-draw'
          return undefined
        },
      },
    },
  },
})
