import * as THREE from 'three';
import type { PerformanceMode } from './constants';
import { facadeMaterial } from './facadeMaterial';
import { windowMaterial } from './windowMaterial';
import { SCENERY_ENV_MAP_INTENSITY } from './crewRig';

/**
 * Dress a scenery GLB's flat-colour parts as facades and windows (#432).
 *
 * The kit ships `baseColorFactor` per part and nothing else, so at dusk
 * (#346) the clubhouse rows sit as grey boxes against a warm sky. This
 * pass replaces the flat materials on building tiers (b/d/g) with:
 *
 *   - a `windowMaterial` when the part's colour matches the glaze palette;
 *   - a `facadeMaterial` (brick/plaster/clapboard, keyed by `paletteKind`)
 *     otherwise.
 *
 * The pass runs on the cached scene: every instance of a model shares the
 * scene's materials, so one walk is enough for every clone. Idempotent
 * through a `__virtualrowPassed` mark, exactly like the crew's own pass.
 */

/** The scenery tiers that carry buildings — the ones this pass acts on. */
const BUILDING_TIERS = new Set(['tier-b', 'tier-d', 'tier-g']);

type MarkedMaterial = THREE.Material & { __virtualrowPassed?: boolean };
const MARK = '__virtualrowPassed';
const isPassed = (m: THREE.Material): boolean => (m as MarkedMaterial)[MARK] === true;
const mark = <T extends THREE.Material>(m: T): T => {
  (m as MarkedMaterial)[MARK] = true;
  return m;
};

/**
 * Is a colour the glaze / window blue-grey the exporter reserves for glass?
 *
 * `scripts/build_scenery.py` picks glass from a narrow range — `#2A3A44`,
 * `#3A4E5A` and friends: dark, cool, moderately saturated. Falling anywhere
 * in that bracket is enough to switch a material to a real window rather
 * than sample a facade normal onto glass.
 */
export const isWindowColor = (color: THREE.Color): boolean => {
  const hsl = { h: 0, s: 0, l: 0 };
  color.clone().convertLinearToSRGB().getHSL(hsl);
  const hueDeg = hsl.h * 360;
  return hsl.l < 0.35 && hueDeg > 180 && hueDeg < 260 && hsl.s > 0.1;
};

/**
 * The tier a scenery GLB path belongs to (`tier-b`, `tier-d`, `tier-g` ...),
 * or `null` if the path does not have one.
 */
export const tierFromPath = (path: string): string | null => {
  const match = /(tier-[a-z])\//.exec(path);
  return match ? match[1] : null;
};

/** Whether a path names a building tier this pass should act on. */
export const isBuildingPath = (path: string): boolean => {
  const tier = tierFromPath(path);
  return tier !== null && BUILDING_TIERS.has(tier);
};

/**
 * Walk a scenery scene and replace facade/window materials in place.
 *
 * The `envMapIntensity` assist (issue #349's `litBySky`) rides on every
 * replacement: a building material still has to reflect the sky the scene
 * is under, or the whole point of the pass is lost.
 */
export const applyScenerySkyPass = (
  root: THREE.Object3D,
  tier: PerformanceMode,
): void => {
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh || Array.isArray(mesh.material)) return;
    const src = mesh.material as THREE.MeshStandardMaterial | null;
    if (!src || isPassed(src)) return;
    if (!(src instanceof THREE.MeshStandardMaterial)) return;

    let next: THREE.Material;
    if (isWindowColor(src.color)) {
      next = windowMaterial(src.color);
    } else {
      next = facadeMaterial(src, { tier });
    }
    if ('envMapIntensity' in next) {
      (next as THREE.MeshStandardMaterial).envMapIntensity = SCENERY_ENV_MAP_INTENSITY;
    }
    mesh.material = mark(next);
    src.dispose();
  });
};
