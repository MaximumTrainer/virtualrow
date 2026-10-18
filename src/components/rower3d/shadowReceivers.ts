// ============================================================================
// Shadow-receiver wiring for Cascaded Shadow Maps (#495 Phase 2).
//
// three's `csm.setupMaterial` OVERWRITES `material.onBeforeCompile`. For a
// material that already has one — the bank's triplanar grass/earth chain in
// `bankMaterial.ts`, for instance — the override silently loses the chunks
// that material was replacing (`<map_fragment>`, `<normal_fragment_maps>`),
// and the whole triplanar effect vanishes.
//
// The composition here saves the material's original `onBeforeCompile` and
// its defines before `csm.setupMaterial`, then chains both callbacks on the
// final material. CSM replaces `<lights_fragment_begin>` while the triplanar
// chain replaces different chunks, so they coexist safely.
// ============================================================================

import type * as THREE from 'three';
import type { CSM } from 'three/examples/jsm/csm/CSM.js';

/** State needed to put a material back to how CSM found it. */
export type SetupRecord = {
  originalOnBeforeCompile: THREE.Material['onBeforeCompile'];
  originalDefines: Record<string, unknown> | undefined;
};

/** `defines` isn't on `THREE.Material`'s typings but is on every material three ships. */
type MaterialWithDefines = THREE.Material & { defines?: Record<string, unknown> };

/**
 * Walks `scene` for `receiveShadow` meshes and runs `csm.setupMaterial` on
 * each material it hasn't seen yet, preserving the material's existing
 * `onBeforeCompile` by chaining both. Returns the number of materials newly
 * registered on this walk, so the caller can log or test the first-frame
 * registration without a scene reference.
 */
export const wireShadowReceivers = (
  csm: CSM,
  scene: THREE.Object3D,
  seen: Map<THREE.Material, SetupRecord>,
): number => {
  let registered = 0;
  scene.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh || !mesh.receiveShadow) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) {
      if (!material || seen.has(material)) continue;
      const originalOnBeforeCompile = material.onBeforeCompile;
      const originalDefines = (material as MaterialWithDefines).defines
        ? { ...(material as MaterialWithDefines).defines }
        : undefined;
      seen.set(material, { originalOnBeforeCompile, originalDefines });
      csm.setupMaterial(material);
      const csmOnBeforeCompile = material.onBeforeCompile;
      // Run the material's own `onBeforeCompile` first (bankMaterial's
      // triplanar replaces `<map_fragment>` and `<normal_fragment_maps>`),
      // then CSM's (which replaces `<lights_fragment_begin>`). Different
      // chunks, so order is a formality; running the material's first keeps
      // CSM's uniforms (`CSM_cascades`, `cameraNear`, `shadowFar`) tracked by
      // CSM's internal `shaders` map on the final shader object.
      //
      // `.call(this, …)` preserves `this` on the chained callback: three
      // invokes `onBeforeCompile` with the material as `this`, and some
      // materials read `this.<field>` from inside — drei's
      // `MeshReflectorMaterial`, for instance, reads `this._hasBlur` to
      // wire its uniforms. A plain `originalOnBeforeCompile(shader, …)`
      // drops that binding and throws on undefined.
      material.onBeforeCompile = function (shader, renderer) {
        originalOnBeforeCompile?.call(this, shader, renderer);
        csmOnBeforeCompile?.call(this, shader, renderer);
      };
      material.needsUpdate = true;
      registered += 1;
    }
  });
  return registered;
};

/** Reverse what `wireShadowReceivers` did, so a tier change doesn't leak. */
export const unwireShadowReceivers = (seen: Map<THREE.Material, SetupRecord>): void => {
  for (const [material, record] of seen) {
    material.onBeforeCompile = record.originalOnBeforeCompile ?? (() => {});
    (material as MaterialWithDefines).defines = record.originalDefines;
    material.needsUpdate = true;
  }
  seen.clear();
};
