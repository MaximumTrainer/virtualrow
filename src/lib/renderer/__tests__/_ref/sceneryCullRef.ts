/**
 * Three-free port of `compactVisible` from
 * `src/components/rower3d/foliagePlan.ts` (#555 D6-a). The P3 compute kernel
 * replicates this same xz-distance test, so the parity test can drive both
 * paths on the same inputs and compare the surviving counts.
 *
 * Lives under `_ref/` so coverage treats it as a test helper, not app code.
 */

export interface SceneryCullInput {
  /** Interleaved xyz per instance (3 floats × N). */
  positions: Float32Array;
  boat: { x: number; y: number; z: number };
  range: number;
}

/**
 * Distance cull — returns the surviving instance indices.
 * Port of the shape of three's `compactVisible`, dropped to a bare xz check
 * (the three function uses `batch.centres[i*2]` / `[i*2+1]` which are
 * exactly `(x, z)`).
 */
export const distanceCullRef = (input: SceneryCullInput): number[] => {
  const rangeSquared = input.range * input.range;
  const n = Math.floor(input.positions.length / 3);
  const survivors: number[] = [];
  for (let i = 0; i < n; i += 1) {
    const dx = input.positions[i * 3 + 0] - input.boat.x;
    const dz = input.positions[i * 3 + 2] - input.boat.z;
    if (dx * dx + dz * dz > rangeSquared) continue;
    survivors.push(i);
  }
  return survivors;
};

/**
 * Six-plane frustum cull replicating `sphereInFrustum` from
 * `src/lib/renderer/math/frustum.ts` on CPU — the same shape the WGSL kernel
 * uses. Takes already-normalised planes (as `extractFrustum` writes them).
 */
export const frustumCullRef = (
  positions: Float32Array,
  radii: Float32Array,
  planes: Float32Array,
): number[] => {
  const n = Math.floor(positions.length / 3);
  const survivors: number[] = [];
  outer: for (let i = 0; i < n; i += 1) {
    const cx = positions[i * 3 + 0];
    const cy = positions[i * 3 + 1];
    const cz = positions[i * 3 + 2];
    const r = radii[i];
    for (let p = 0; p < 6; p += 1) {
      const a = planes[p * 4];
      const b = planes[p * 4 + 1];
      const c = planes[p * 4 + 2];
      const d = planes[p * 4 + 3];
      if (a * cx + b * cy + c * cz + d < -r) continue outer;
    }
    survivors.push(i);
  }
  return survivors;
};
