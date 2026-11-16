import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    babel({ presets: [reactCompilerPreset()] })
  ],
  build: {
    target: 'es2022',
    cssCodeSplit: true,
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          // Match @react-three before bare "three" (substring would steal r3f/drei).
          if (id.includes('@react-three')) return 'r3f'
          if (id.includes(`${'node_modules'}/three`) || id.includes('node_modules\\three')) return 'three'
          if (id.includes('react-dom') || id.includes('/react/') || id.includes('\\react\\')) return 'react'
        },
      },
    },
  },
})
