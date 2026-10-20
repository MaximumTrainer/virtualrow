// #542 P0: client-rendered SPA, the same runtime model as the React build.
// `ssr = false` — there is no server rendering; the renderer is a browser-only
// WebGPU/WebGL surface. `prerender = true` with adapter-static emits the
// `index.html` fallback so every route is served by the static host.
export const prerender = true;
export const ssr = false;
