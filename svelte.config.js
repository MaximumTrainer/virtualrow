import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

// #542 P0: SvelteKit scaffold. adapter-static in SPA mode (a single
// `index.html` fallback, no per-route prerender) because the app is a
// client-rendered simulator — there is no server at runtime, same as the
// Vite/React build it replaces. `paths.base` keeps the deploy sub-path the
// React build served from (`--base=/virtualrow/app/`); SvelteKit sets `base`
// from here instead of a CLI flag. BASE_PATH lets the preview deploy build
// the same tree under `/virtualrow/next/` without a code change.
const base = process.env.BASE_PATH ?? '/virtualrow/app';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter({ fallback: 'index.html' }),
    // Keep the existing Vite `public/` tree (models, auth assets, vite.svg) as
    // the static root instead of SvelteKit's default `static/` — non-destructive
    // for P0; the files move in a later phase if we want the convention.
    files: { assets: 'public' },
    paths: { base, relative: false },
    // `$lib` already maps to `src/lib`; this is explicit so the move in P0
    // reads clearly and editors resolve it without `svelte-kit sync` first.
    alias: { $lib: 'src/lib' },
  },
};

export default config;
