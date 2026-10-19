import type * as THREE from 'three';

/**
 * Write the matrices of `batch`'s visible instances to the front of `mesh`'s
 * `instanceMatrix` buffer, in the order `indices` lists them. Mirrors what
 * `compactVisible` in `foliagePlan.ts` does, but driven by a list of indices
 * the GPU compute kernel produced instead of walking centres on the CPU.
 *
 * Returns the count written, which the caller sets as `mesh.count`.
 */
export const applyIndicesToMesh = (
  mesh: THREE.InstancedMesh,
  sourceMatrices: Float32Array,
  indices: Uint32Array,
): number => {
  const target = mesh.instanceMatrix.array as Float32Array;
  for (let i = 0; i < indices.length; i += 1) {
    const srcOffset = indices[i] * 16;
    target.set(sourceMatrices.subarray(srcOffset, srcOffset + 16), i * 16);
  }
  mesh.count = indices.length;
  mesh.instanceMatrix.clearUpdateRanges();
  mesh.instanceMatrix.addUpdateRange(0, indices.length * 16);
  mesh.instanceMatrix.needsUpdate = true;
  return indices.length;
};
