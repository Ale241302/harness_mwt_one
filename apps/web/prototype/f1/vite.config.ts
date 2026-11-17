import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const here = (rel: string): string => fileURLToPath(new URL(rel, import.meta.url))

/**
 * Prototype build for the F1 appearance gate.
 *
 * React is aliased to one physical copy: the surface lives in another workspace
 * package that carries its own link, and two copies in one page break hooks.
 */
export default defineConfig({
  root: here('./'),
  base: './',
  plugins: [react()],
  resolve: {
    dedupe: ['react', 'react-dom'],
    alias: {
      react: here('../../node_modules/react'),
      'react-dom': here('../../node_modules/react-dom'),
    },
  },
  build: {
    outDir: here('./dist'),
    emptyOutDir: true,
  },
})
