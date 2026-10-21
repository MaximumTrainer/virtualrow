/**
 * Procedural-building GPU plan (#566 FR1 / D1-b).
 *
 * One pool per route holds every building's instance data as four f32 slots:
 *   `(x, z, height, bitcast<f32>(packedPaletteIndex))`
 *
 * The vertex shader uses `vertex_index` + `instance_index` to synthesise a
 * unit-box prism (two triangles per side × four sides + roof + floor) at
 * (`x`, 0, `z`) with the per-instance height. Keeping the vertex buffer the
 * same twelve-triangle prism for every building keeps the pass to one
 * `drawIndexed` call per route, matching the P3 pool model (#566 D2-a).
 *
 * The fourth lane carries a packed index into a palette of base/wall/roof
 * colour trios (D3-a). Four trios are enough to carry the three mapped OSM
 * profiles (`residential`, `commercial`, `industrial`) plus a `fallback`
 * grey — the palette is small, so growing it later is a one-line change
 * both here and in the shader. A `BuildingSpec`'s coordinates are world
 * metres and are left to the caller to compute from OSM footprints or a
 * procedural generator.
 */

/// <reference types="@webgpu/types" />

export const BUILDINGS_FLOATS_PER_INSTANCE = 4;

/** Build-time palette index. The WGSL side keeps the same ordering. */
export type BuildingProfile = 'residential' | 'commercial' | 'industrial' | 'fallback';

/**
 * Zero-indexed palette slot. Exported so the extrusion step can hand the
 * right lookup to a `BuildingSpec` without a string in the hot path.
 */
export const BUILDING_PROFILE_INDEX: Record<BuildingProfile, number> = {
  residential: 0,
  commercial: 1,
  industrial: 2,
  fallback: 3,
};

export interface BuildingSpec {
  /** World X of the footprint centre. */
  x: number;
  /** World Z of the footprint centre. */
  z: number;
  /** Half-width along X in metres (so the prism spans `x ± halfWidth`). */
  halfWidth: number;
  /** Half-depth along Z. */
  halfDepth: number;
  /** Height in metres from `y = 0` upward. */
  height: number;
  /** Palette index — defaults to `fallback` if omitted or out of range. */
  profile?: BuildingProfile;
}

export interface BuildingPlan {
  /** `vec4<f32>` per instance (x, z, height, bitcast(paletteIndex)). */
  instances: Float32Array;
  instanceCount: number;
  /** Pre-computed metres² of building footprint for the memory-bound AC. */
  footprintM2: number;
}

/**
 * Pack a list of specs into one tightly-interleaved instance buffer that
 * the WGSL side can read as `array<vec4<f32>>`. The fourth lane carries
 * the palette index as a `u32` bit pattern — WGSL unbitcasts on read.
 */
export const packBuildings = (specs: readonly BuildingSpec[]): BuildingPlan => {
  const n = specs.length;
  const instances = new Float32Array(n * BUILDINGS_FLOATS_PER_INSTANCE);
  const meta32 = new Uint32Array(instances.buffer);
  let footprintM2 = 0;
  for (let i = 0; i < n; i += 1) {
    const s = specs[i];
    instances[i * 4 + 0] = s.x;
    // Fourth-lane sibling of the width — pack half-width into the first
    // slot of a `vec2<f32>` keyed by `instance_index` on the GPU side via
    // the dedicated `sizesBuffer` below. Keeping the position vec4
    // position-only means the shadow pass can read the same binding.
    instances[i * 4 + 1] = s.z;
    instances[i * 4 + 2] = Math.max(0, s.height);
    const paletteIndex =
      s.profile !== undefined && s.profile in BUILDING_PROFILE_INDEX
        ? BUILDING_PROFILE_INDEX[s.profile]
        : BUILDING_PROFILE_INDEX.fallback;
    meta32[i * 4 + 3] = paletteIndex >>> 0;
    footprintM2 += Math.max(0, s.halfWidth * 2) * Math.max(0, s.halfDepth * 2);
  }
  return { instances, instanceCount: n, footprintM2 };
};

/**
 * Companion sizes buffer: `vec2<f32>` per instance (halfWidth, halfDepth).
 * Kept separate from `instances` so the depth pass can share the same
 * position + size bindings without reading an extra palette index.
 */
export const packBuildingSizes = (specs: readonly BuildingSpec[]): Float32Array => {
  const out = new Float32Array(specs.length * 2);
  for (let i = 0; i < specs.length; i += 1) {
    out[i * 2 + 0] = Math.max(0.1, specs[i].halfWidth);
    out[i * 2 + 1] = Math.max(0.1, specs[i].halfDepth);
  }
  return out;
};

export interface BuildingPool {
  /** `vec4<f32>` interleaved `(x, z, height, bitcast(paletteIndex))`. */
  centresBuffer: GPUBuffer;
  /** `vec2<f32>` per instance `(halfWidth, halfDepth)`. */
  sizesBuffer: GPUBuffer;
  instanceCount: number;
  footprintM2: number;
  dispose(): void;
}

export const createBuildingPool = (
  device: GPUDevice,
  specs: readonly BuildingSpec[],
): BuildingPool => {
  const plan = packBuildings(specs);
  const sizes = packBuildingSizes(specs);
  const centresBuffer = device.createBuffer({
    label: 'buildings-centres',
    size: Math.max(16, plan.instances.byteLength),
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  if (plan.instances.byteLength > 0) {
    device.queue.writeBuffer(centresBuffer, 0, plan.instances as BufferSource);
  }
  const sizesBuffer = device.createBuffer({
    label: 'buildings-sizes',
    size: Math.max(16, sizes.byteLength),
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  if (sizes.byteLength > 0) {
    device.queue.writeBuffer(sizesBuffer, 0, sizes as BufferSource);
  }
  let disposed = false;
  return {
    centresBuffer,
    sizesBuffer,
    instanceCount: plan.instanceCount,
    footprintM2: plan.footprintM2,
    dispose() {
      if (disposed) return;
      disposed = true;
      centresBuffer.destroy();
      sizesBuffer.destroy();
    },
  };
};

/**
 * Deterministic smoke-page helper: lay `count` buildings on both banks of
 * a canned straight-line route, alternating profiles so the palette gets
 * exercised. Mirrors the shape of `buildSmokeFoliagePools` from #555 so
 * the engine smoke pages read alike.
 */
export const buildSmokeBuildings = (opts: {
  count: number;
  spacingMetres?: number;
  lateralOffset?: number;
  heightMetres?: number;
}): BuildingSpec[] => {
  const spacing = opts.spacingMetres ?? 20;
  const lateral = opts.lateralOffset ?? 18;
  const defaultHeight = opts.heightMetres ?? 8;
  const PROFILES: BuildingProfile[] = ['residential', 'commercial', 'industrial', 'fallback'];
  const specs: BuildingSpec[] = [];
  for (let i = 0; i < opts.count; i += 1) {
    const side = (i & 1) === 0 ? -1 : 1;
    const x = side * (lateral + (i % 3) * 1.5);
    const z = -i * spacing;
    const halfWidth = 3 + (i % 4) * 0.4;
    const halfDepth = 3 + ((i * 2) % 4) * 0.3;
    const height = defaultHeight + ((i * 7) % 11) * 0.5;
    specs.push({
      x,
      z,
      halfWidth,
      halfDepth,
      height,
      profile: PROFILES[i % PROFILES.length],
    });
  }
  return specs;
};
