/**
 * GPU-driven scenery pool layout (#555 FR1, D1-a).
 *
 * A pool is the renderer's unit of GPU scenery: one species × chunk of
 * foliage, or one scenery category × band, or `courseFurniture`. Each pool
 * ships a `centresBuffer` of `vec4<f32>` instances (xyz = world position;
 * w = packed metadata — sway seed / scale / species index) and a tight
 * `bounds` sphere for the frustum cull. The compute kernel in
 * `passes/sceneryCull.wgsl` reads one pool at a time and writes a compact
 * `indices` buffer + a `drawIndirect` buffer; the render pass in
 * `passes/scenery.wgsl` then issues one `drawIndirect` per pool
 * (#555 D3-c — no multi-draw merge).
 *
 * The three scene's `batchFoliageChunked` / `sceneryPlacement` modules are
 * deeply three-coupled, so this port keeps the renderer three-free: it
 * accepts primitive `{ centres, metadata? }` + a bounding sphere and
 * synthesises buffers. A later phase ports the three-side placement code
 * on top of this interface; today's smoke page builds pools by hand.
 */

/// <reference types="@webgpu/types" />

export const INSTANCE_STRIDE_FLOATS = 4; // vec4<f32> per instance

export type SceneryKind = 'foliage' | 'scenery' | 'furniture';

export interface PoolBounds {
  /** Centre of the pool's bounding sphere in world space. */
  cx: number;
  cy: number;
  cz: number;
  /** Radius enclosing every instance in the pool. */
  radius: number;
}

export interface PoolInput {
  kind: SceneryKind;
  /** Species index inside its kind (foliage species, scenery category id, …). */
  speciesIndex: number;
  /** Optional chunk index — only meaningful for `foliage`. */
  chunkIndex?: number;
  /**
   * Interleaved xyz per instance (3 floats * instanceCount). The pool packer
   * zips these with `metadata` into vec4<f32>s on the GPU side.
   */
  positions: Float32Array;
  /**
   * Optional per-instance metadata as u32 (one entry per instance). When
   * omitted the pool packs zero. Reinterpreted as f32 by `bitcast<f32>()` in
   * the WGSL cull / draw path so the fourth lane survives the vertex-shader
   * trip without losing bits.
   */
  metadata?: Uint32Array;
  bounds: PoolBounds;
}

export interface InstancePool {
  kind: SceneryKind;
  speciesIndex: number;
  chunkIndex: number;
  instanceCount: number;
  /** `vec4<f32>` interleaved {x, y, z, bitcast(meta)}. */
  centresBuffer: GPUBuffer;
  bounds: PoolBounds;
  /** CPU-side copy, kept for the parity reference pass. */
  centresCpu: Float32Array;
  dispose(): void;
}

export interface PackedPoolData {
  centres: Float32Array;
  instanceCount: number;
}

/**
 * Pack `positions` + optional `metadata` into an interleaved `vec4<f32>`
 * buffer the GPU side can read in one storage binding. The fourth lane
 * carries the u32 metadata reinterpreted as f32; WGSL un-bitcasts on read.
 *
 * Exported for the parity reference pass (`sceneryCullRef.ts`) and the
 * unit tests.
 */
export const packPoolCentres = (
  positions: Float32Array,
  metadata?: Uint32Array,
): PackedPoolData => {
  const instanceCount = Math.floor(positions.length / 3);
  const centres = new Float32Array(instanceCount * INSTANCE_STRIDE_FLOATS);
  const meta32 = new Uint32Array(centres.buffer);
  for (let i = 0; i < instanceCount; i += 1) {
    centres[i * 4 + 0] = positions[i * 3 + 0];
    centres[i * 4 + 1] = positions[i * 3 + 1];
    centres[i * 4 + 2] = positions[i * 3 + 2];
    // Reinterpret u32 → the same bit pattern as f32. WGSL bitcast reverses it.
    meta32[i * 4 + 3] = metadata ? metadata[i] : 0;
  }
  return { centres, instanceCount };
};

export const createInstancePool = (device: GPUDevice, input: PoolInput): InstancePool => {
  const { centres, instanceCount } = packPoolCentres(input.positions, input.metadata);
  const centresBuffer = device.createBuffer({
    label: `scenery-centres:${input.kind}:${input.speciesIndex}`,
    size: Math.max(16, centres.byteLength),
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  if (centres.byteLength > 0) {
    device.queue.writeBuffer(centresBuffer, 0, centres as BufferSource);
  }
  let disposed = false;
  return {
    kind: input.kind,
    speciesIndex: input.speciesIndex,
    chunkIndex: input.chunkIndex ?? 0,
    instanceCount,
    centresBuffer,
    bounds: { ...input.bounds },
    centresCpu: centres,
    dispose() {
      if (disposed) return;
      disposed = true;
      centresBuffer.destroy();
    },
  };
};

/**
 * Convenience: build a short straight-line foliage chunk sequence for the
 * smoke page. Produces `speciesCount` species × `chunkCount` chunks, each
 * with `perChunk` trees spaced along +Z with a small lateral offset so the
 * compute cull has non-trivial geometry to walk.
 *
 * Keep this focused on the smoke story: no three dependency, deterministic,
 * no network. The full-fidelity placement port is a later phase.
 */
export const buildSmokeFoliagePools = (opts: {
  speciesCount: number;
  chunkCount: number;
  perChunk: number;
  spacingMetres?: number;
  lateralOffset?: number;
}): PoolInput[] => {
  const spacing = opts.spacingMetres ?? 4;
  const lateral = opts.lateralOffset ?? 7;
  const pools: PoolInput[] = [];
  for (let s = 0; s < opts.speciesCount; s += 1) {
    for (let c = 0; c < opts.chunkCount; c += 1) {
      const positions = new Float32Array(opts.perChunk * 3);
      const metadata = new Uint32Array(opts.perChunk);
      let minX = Infinity;
      let maxX = -Infinity;
      let minZ = Infinity;
      let maxZ = -Infinity;
      for (let i = 0; i < opts.perChunk; i += 1) {
        // Alternate banks so the cull keeps both sides busy.
        const side = (i & 1) === 0 ? -1 : 1;
        const x = side * (lateral + (s * 2.5) + ((i * 0.17) % 1.5));
        const y = 0;
        const z = -(c * opts.perChunk + i) * spacing;
        positions[i * 3 + 0] = x;
        positions[i * 3 + 1] = y;
        positions[i * 3 + 2] = z;
        // Sway seed packed into the top 16 bits; species index into the low 16.
        metadata[i] = ((i * 2654435761) >>> 0) & 0xffff0000 | ((s & 0xffff) >>> 0);
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (z < minZ) minZ = z;
        if (z > maxZ) maxZ = z;
      }
      const cx = (minX + maxX) / 2;
      const cz = (minZ + maxZ) / 2;
      const half = Math.max(maxX - cx, maxZ - cz);
      const radius = Math.hypot(half, 4) + 4;
      pools.push({
        kind: 'foliage',
        speciesIndex: s,
        chunkIndex: c,
        positions,
        metadata,
        bounds: { cx, cy: 0, cz, radius },
      });
    }
  }
  return pools;
};
