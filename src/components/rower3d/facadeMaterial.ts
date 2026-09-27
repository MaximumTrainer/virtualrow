import * as THREE from 'three';
import type { PerformanceMode } from './constants';
import {
  brickNormalMap,
  clapboardNormalMap,
  plasterNormalMap,
} from './detailTextures';
import { paletteKind, type PaletteKind } from './paletteKind';

/**
 * A material for a building facade, keyed by the part's flat colour (#432).
 *
 * The scenery kit ships `baseColorFactor` per part and nothing else, so at
 * dusk (#346) the clubhouse rows sit as grey boxes against a warm sky.
 * `facadeMaterial` looks at what colour the exporter gave the part and picks
 * one of three tiling normal maps — brick, plaster, or clapboard — so the
 * light on the wall reads as the material it is.
 *
 * Not triplanar in this pass: the scenery kit's UVs come out of CadQuery
 * with predictable per-face parameterisation, so a UV-based normal is close
 * enough to a world-tiling one for the sizes the models are drawn at. A
 * follow-up on top of #430's bank shader lands the triplanar chunk that
 * costs a driver-compile and pays for itself only on larger surfaces.
 *
 * Low tier drops the normal map: the colour alone is what a rower at a
 * distance actually sees, and a fresh normal-map allocation per part is not
 * a cost that tier should pay.
 */

/** Metres the normal map covers before it repeats — read by callers wiring UVs. */
export const FACADE_TILE_METRES = 0.5;

export interface FacadeMaterialOptions {
  tier: PerformanceMode;
}

const NORMAL_FOR: Record<PaletteKind, () => THREE.CanvasTexture | null> = {
  brick: brickNormalMap,
  plaster: plasterNormalMap,
  clapboard: clapboardNormalMap,
};

export const facadeMaterial = (
  src: THREE.MeshStandardMaterial,
  options: FacadeMaterialOptions,
): THREE.MeshStandardMaterial => {
  const kind = paletteKind(src.color);
  const base: THREE.MeshStandardMaterialParameters = {
    color: src.color,
    roughness: 0.85,
    metalness: 0,
  };
  if (options.tier === 'low') return new THREE.MeshStandardMaterial(base);

  const normal = NORMAL_FOR[kind]();
  if (!normal) return new THREE.MeshStandardMaterial(base);
  return new THREE.MeshStandardMaterial({
    ...base,
    normalMap: normal,
    normalScale: new THREE.Vector2(0.4, 0.4),
  });
};
