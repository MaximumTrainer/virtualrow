import { assetUrl } from './assetUrl';

/**
 * The shipped GLB kit's manifest, as the app reads it (issue #332).
 *
 * `scripts/generate-scenery-manifest.mjs` writes it from the files on disk.
 * The scene loads a route's models a few at a time, because asking a static
 * host for 58 GLBs at once earned a 503 (#232) - and which few went first was
 * whatever order the selection matrix happened to list them in. Knowing what
 * each one weighs is what turns that into a decision.
 */

export interface SceneryManifestEntry {
  /** Path under `public/`, e.g. `assets/scenery/tier-f/f01-bank-earth-cut.glb`. */
  path: string;
  bytes: number;
  triangles: number;
  compressed: boolean;
}

export interface SceneryManifest {
  totalBytes: number;
  models: Record<string, SceneryManifestEntry>;
}

let pending: Promise<SceneryManifest | null> | null = null;

const looksLikeAManifest = (value: unknown): value is SceneryManifest =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as SceneryManifest).totalBytes === 'number' &&
  typeof (value as SceneryManifest).models === 'object' &&
  (value as SceneryManifest).models !== null;

/**
 * Read the manifest, once per session.
 *
 * Never rejects. The manifest is an optimisation, not a dependency: without it
 * the models load in the order the selection matrix lists them, which is what
 * happened before there was a manifest at all. A row must not fail because a
 * JSON file 404'd.
 */
export const loadSceneryManifest = (): Promise<SceneryManifest | null> => {
  // The literal stays here beside its assetUrl call: a path lifted out into
  // a constant is a path that can be fetched without the deploy's base (#251).
  pending ??= fetch(assetUrl('/assets/scenery/manifest.json'))
    .then((response) => (response.ok ? response.json() : null))
    .then((value: unknown) => (looksLikeAManifest(value) ? value : null))
    .catch(() => null);
  return pending;
};

/** Forget the cached read. For tests; nothing in the app re-reads it. */
export const resetSceneryManifest = (): void => {
  pending = null;
};

/** `/virtualrow/app/assets/scenery/tier-f/f01-bank-earth-cut.glb` → `f01-bank-earth-cut`. */
export const modelIdFromPath = (path: string): string =>
  path.split('/').pop()?.replace(/\.glb$/i, '') ?? '';

/**
 * A route's model URLs, cheapest first.
 *
 * The scene fills its first chunk from the front of this list, so a route no
 * longer spends it on the three heaviest models in the kit while the rower
 * looks at an empty bank. Stable: two models of the same size keep the order
 * they came in, because a chunk boundary moving under a model that has already
 * loaded would unmount it.
 */
export const orderByCost = (paths: string[], manifest: SceneryManifest | null): string[] => {
  if (!manifest) return paths;

  // A model the manifest has never heard of goes last, where a surprise
  // cannot hold up the models whose size is known.
  const cost = (path: string) => manifest.models[modelIdFromPath(path)]?.bytes ?? Infinity;

  return paths
    .map((path, index) => ({ path, index, bytes: cost(path) }))
    .sort((a, b) => a.bytes - b.bytes || a.index - b.index)
    .map((entry) => entry.path);
};
