import { sveltekit } from '@sveltejs/kit/vite'
import { defineConfig } from 'vite'

// #542 P0: the React build entry (`index.html` → `src/main.tsx`) is retired
// in favour of SvelteKit, which owns the Vite config through its plugin and
// the `src/routes` tree. The React source stays on the branch (quarantined,
// still unit-tested) until P1 ports each screen.
//
// https://vite.dev/config/
export default defineConfig({
  // `.glsl` and `.wgsl` files are shaders, not modules (#341). They are
  // imported with `?raw` and spliced into the renderer's own shaders at
  // compile time, which is the only thing that can compile them. Without
  // this, a tool that walks the module graph (e.g. `vitest related`) hands
  // one to the JS parser and fails on the first line that is not also valid
  // JavaScript.
  assetsInclude: ['**/*.glsl', '**/*.wgsl'],
  plugins: [sveltekit()],
  worker: {
    format: 'es',
  },
})
