import * as THREE from 'three';
import type { PerformanceMode } from './constants';
import {
  carbonWeaveNormalMap,
  lycraKnitNormalMap,
  resetDetailTexturesForTesting,
} from './detailTextures';

// ============================================================================
// MATERIAL PASS FOR CREW GLBs (#354)
//
// Every crewed GLB ships a flat `baseColorFactor` per part and nothing else;
// the sky environment (#349) gave it something to reflect, so materials that
// answer to a reflection are worth building. This is a pure function over a
// `THREE.Object3D`: rules match by node name, and the first matching rule
// replaces the mesh's material with one authored for what it is.
//
// The rule table replaces `dressScull()` (the earlier ad-hoc pass in
// `crewRig.ts`): #354's spec is a rule table, and the same shape covers the
// hull, the rower's kit, the rower's skin and the oar blade in one place.
//
// Idempotent per node: the replacement material carries a `__virtualrowPassed`
// mark that skips a node the pass has already touched, so mounting the same
// scull twice does not build two carbon-weave normals for it.
// ============================================================================

/**
 * A THREE material may have a boolean `__virtualrowPassed` mark installed by
 * this pass, so a second run over the same tree recognises what it built.
 */
type MarkedMaterial = THREE.Material & { __virtualrowPassed?: boolean };

const MARK = '__virtualrowPassed';

const mark = <T extends THREE.Material>(material: T): T => {
  (material as MarkedMaterial)[MARK] = true;
  return material;
};

const isPassed = (material: THREE.Material): boolean =>
  (material as MarkedMaterial)[MARK] === true;

export interface MaterialPassOptions {
  tier: PerformanceMode;
}

interface Rule {
  /** Node-name pattern. A node with no matching rule is left alone. */
  match: RegExp;
  /**
   * Build the replacement material. `src` is the mesh's current material — the
   * caller reads its `color` and passes it here.
   */
  apply: (src: THREE.MeshStandardMaterial, o: MaterialPassOptions) => THREE.Material;
}

const hullRule: Rule = {
  match: /^Hull/,
  apply: (src, o) =>
    Object.assign(
      new THREE.MeshPhysicalMaterial({
        color: src.color,
        roughness: 0.25,
        metalness: 0,
        clearcoat: 1,
        clearcoatRoughness: 0.08,
        envMapIntensity: 1.2,
      }),
      o.tier === 'low'
        ? {}
        : { normalMap: carbonWeaveNormalMap(), normalScale: new THREE.Vector2(0.4, 0.4) },
    ),
};

// Rower cloth: the kit gets a lycra micro-normal and a soft sheen. Sheen is
// tinted with the kit's own colour so a black singlet keeps its edge glow, not
// a stock cream one.
const rowerClothRule: Rule = {
  match: /^Rower_(Torso|LeftArm|RightArm|Leg)/,
  apply: (src, o) =>
    Object.assign(
      new THREE.MeshPhysicalMaterial({
        color: src.color,
        roughness: 0.7,
        sheen: 0.25,
        sheenColor: src.color,
      }),
      o.tier === 'low'
        ? {}
        : { normalMap: lycraKnitNormalMap(), normalScale: new THREE.Vector2(0.3, 0.3) },
    ),
};

// Rower skin: no normal map, warm sheen colour. `Head/Hand/Skin` covers what
// build_crew.py exports today and the extra parts the rig gains next.
const SKIN_SHEEN = new THREE.Color('#f0c8ad');
const rowerSkinRule: Rule = {
  match: /^Rower_(Head|Hand|Skin)/,
  apply: (src) =>
    new THREE.MeshPhysicalMaterial({
      color: src.color,
      roughness: 0.55,
      sheen: 0.3,
      sheenColor: SKIN_SHEEN,
    }),
};

const bladeRule: Rule = {
  // `Blade$` catches `LeftOar_Blade_part` too: the exporter hangs geometry on
  // a `_part` child, so the material lives on that node.
  match: /Blade(_part)?$/,
  apply: (src) =>
    new THREE.MeshPhysicalMaterial({
      color: src.color,
      roughness: 0.4,
      clearcoat: 0.5,
    }),
};

const RULES: Rule[] = [hullRule, rowerClothRule, rowerSkinRule, bladeRule];

/**
 * Walk the tree, replace the material on any mesh whose name matches a rule,
 * dispose the material that was there. Returns the same root for chaining.
 *
 * Nodes with no matching rule keep their material. The rigger, the gates and
 * the seat live under other names, and they were already dressed on load by
 * `crewRig.dressScull` — that function is the caller's next step, not this
 * one's replacement.
 */
export const applyMaterialPass = (
  root: THREE.Object3D,
  options: MaterialPassOptions,
): THREE.Object3D => {
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    if (Array.isArray(mesh.material)) return;
    const src = mesh.material as THREE.MeshStandardMaterial | null;
    if (!src) return;
    if (isPassed(src)) return;
    const rule = RULES.find((r) => r.match.test(mesh.name));
    if (!rule) return;
    const next = mark(rule.apply(src, options));
    mesh.material = next;
    src.dispose();
  });
  return root;
};

/** Only for tests: clear the detail-texture cache and rebuild on next call. */
export const resetMaterialPassCacheForTesting = (): void => {
  resetDetailTexturesForTesting();
};
