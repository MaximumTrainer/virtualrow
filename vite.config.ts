import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  // `.glsl` files are shaders, not modules (#341).
  //
  // They are imported with `?raw` and spliced into three's own shaders at
  // `onBeforeCompile`, which is the only thing that can compile them. Without
  // this, `vitest related` - which walks the module graph of a changed file -
  // hands one to the JS parser and fails on the first line of GLSL that is not
  // also valid JavaScript. The direct run never hit it, so the pre-commit hook
  // was the first thing to notice.
  assetsInclude: ['**/*.glsl'],
  plugins: [
    react(),
  ],
  worker: {
    format: 'es',
  },
})
