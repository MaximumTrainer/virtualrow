import type * as THREE from 'three';
import type { SkyConfig } from './themeConfig';
import * as skyEnvironmentModule from './skyEnvironment';

/**
 * The sky PMREM, built once and shared (#418).
 *
 * The water and `scene.environment` want the same map: an environment light
 * from the sky the row is under. Built independently they each pay a PMREM
 * convolution — about four seconds on the software rasteriser CI draws with,
 * which is why the two call-sites both skipped automation. Built once, kept
 * alive while at least one consumer holds a handle, and disposed with the
 * last release, it costs once and both callers hold the same texture object.
 *
 * The key is the sky config. `sunPosition` is one of its fields, so the
 * midday and dusk presets in #346 are naturally different keys.
 */

interface Entry {
  texture: THREE.Texture;
  /** How many live consumers hold a handle for this key. Zero means dispose. */
  refs: number;
}

export interface SkyEnvironmentHandle {
  /** The convolved sky, or null where the renderer could not convolve one. */
  readonly texture: THREE.Texture | null;
  /** Give up this consumer's claim on the texture. Idempotent (AC1.4). */
  release: () => void;
}

const NULL_HANDLE: SkyEnvironmentHandle = { texture: null, release: () => undefined };

const cache = new Map<string, Entry>();
let buildCount = 0;

/** Stable key on the fields the sky map depends on: the whole SkyConfig. */
const keyFor = (sky: SkyConfig, sunPosition: readonly [number, number, number]): string =>
  `${sky.turbidity}|${sky.rayleigh}|${sky.mieCoefficient}|${sky.mieDirectionalG}|${sky.exposure}|${sunPosition.join(',')}`;

export const acquireSkyEnvironment = (
  renderer: THREE.WebGLRenderer,
  sky: SkyConfig,
  sunPosition: readonly [number, number, number],
): SkyEnvironmentHandle => {
  const key = keyFor(sky, sunPosition);
  const entry = cache.get(key);

  if (entry) {
    entry.refs += 1;
    return handleFor(key, entry);
  }

  const texture = skyEnvironmentModule.buildSkyEnvironment(renderer, sky, sunPosition);
  buildCount += 1;
  if (!texture) return NULL_HANDLE;

  const fresh: Entry = { texture, refs: 1 };
  cache.set(key, fresh);
  return handleFor(key, fresh);
};

const handleFor = (key: string, entry: Entry): SkyEnvironmentHandle => {
  let released = false;
  return {
    texture: entry.texture,
    release: () => {
      if (released) return;
      released = true;
      entry.refs -= 1;
      if (entry.refs <= 0) {
        entry.texture.dispose();
        cache.delete(key);
      }
    },
  };
};

/** For tests: how many builds have been called through the cache. */
export const buildCountForTesting = (): number => buildCount;

/** For tests: forget every entry, without disposing (a fake texture in a mock). */
export const resetSkyEnvironmentCacheForTesting = (): void => {
  cache.clear();
  buildCount = 0;
};
