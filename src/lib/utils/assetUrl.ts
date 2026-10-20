// ============================================================================
// ASSET URLS THAT SURVIVE THE DEPLOY
//
// The site is built with `--base=/virtualrow/app/`, so everything in public/ is
// published under that prefix. Every 3D asset URL was written from the domain
// root instead — `/assets/boat/scull-male.glb` — so in production the browser
// asked for a path one directory above where the file actually is, and every
// GLB 404'd: both crewed sculls and all 130 scenery models, on every route.
//
// It survived because dev and Playwright both serve from `/`, where BASE_URL is
// `/` and the two forms coincide. Only a non-root base tells them apart, which
// is why the tests for this set one (issue #251).
// ============================================================================

/** True for anything already carrying its own origin or protocol. */
const isAbsolute = (url: string): boolean => /^[a-z][a-z0-9+.-]*:|^\/\//i.test(url);

/**
 * Resolve a path in `public/` to the URL it has on this deployment.
 *
 * Idempotent: a URL that already carries the base is returned unchanged, so
 * passing an already-resolved URL through a second time is harmless.
 */
export const assetUrl = (path: string): string => {
  if (isAbsolute(path)) return path;

  const base = (import.meta.env.BASE_URL ?? '/').replace(/\/+$/, '');
  if (!base) return path.startsWith('/') ? path : `/${path}`;

  const rest = path.startsWith('/') ? path : `/${path}`;
  return rest.startsWith(`${base}/`) ? rest : `${base}${rest}`;
};
