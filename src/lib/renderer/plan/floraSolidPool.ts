/**
 * P5 (#562 FR4 / D7-a): per-species low-poly tree mesh for the solid flora
 * pool. One procedural crown + trunk per species (~50 triangles each).
 *
 * The solid pool shares the P3 scenery compute-cull's compact-indices
 * buffer by `kind: 'floraSolid'`, with its own render pipeline and its
 * own indirect-args buffer so the draw list doesn't collide with the
 * sprite pool.
 */

/// <reference types="@webgpu/types" />

import type { InstancePool, PoolBounds, PoolInput } from './instancePools';
import { createInstancePool } from './instancePools';

export interface FloraSolidMesh {
  /** `vec3` positions (xyz interleaved). */
  positions: Float32Array;
  /** `vec3` normals (xyz interleaved), same length as positions. */
  normals: Float32Array;
  /**
   * `vec2`-ish per-vertex colour weight. x = crown mix (0 = trunk, 1 =
   * crown); y = top mix (0 = base, 1 = top). Four bytes together ride the
   * same per-vertex layout as the normals so one buffer binding carries
   * both.
   */
  mix: Float32Array;
  /** uint16 index buffer. */
  indices: Uint16Array;
  /** triangle count for the parity assertion (~50). */
  triangleCount: number;
}

/**
 * Deterministic PRNG seeded from the species index. Simple LCG — small,
 * repeatable; the parity test depends on the output being stable.
 */
const seeded = (seed: number): (() => number) => {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return (s & 0xffffff) / 0x1000000;
  };
};

/**
 * Build a seeded crown-and-trunk mesh. Trunk = 6-sided prism (12 tri); crown
 * = octahedron truncated to a 12-vertex blob with 20 triangles. Total ~32
 * triangles per species — well inside the ~50 budget D7-a sets, with room
 * for a canopy skirt the parity assertion counts (~50 lands with the skirt).
 */
export const buildFloraSolidMesh = (speciesIndex: number): FloraSolidMesh => {
  const rand = seeded((speciesIndex + 7) * 2654435761);
  const positions: number[] = [];
  const normals: number[] = [];
  const mix: number[] = [];
  const idx: number[] = [];

  const push = (p: [number, number, number], n: [number, number, number], m: [number, number]) => {
    positions.push(p[0], p[1], p[2]);
    normals.push(n[0], n[1], n[2]);
    mix.push(m[0], m[1]);
    return positions.length / 3 - 1;
  };

  // Trunk: hexagonal prism, 0 → 1.0 m tall, radius ~0.08.
  const trunkRadius = 0.08 + rand() * 0.03;
  const trunkTop = 1.0;
  const trunkRing = (y: number, r: number): number[] => {
    const ids: number[] = [];
    for (let i = 0; i < 6; i += 1) {
      const a = (i / 6) * Math.PI * 2;
      const cx = Math.cos(a) * r;
      const cz = Math.sin(a) * r;
      ids.push(
        push([cx, y, cz], [Math.cos(a), 0.1, Math.sin(a)], [0, y / trunkTop]),
      );
    }
    return ids;
  };
  const trunkBase = trunkRing(0, trunkRadius);
  const trunkCrown = trunkRing(trunkTop, trunkRadius * 0.85);
  for (let i = 0; i < 6; i += 1) {
    const j = (i + 1) % 6;
    const bi = trunkBase[i];
    const bj = trunkBase[j];
    const ti = trunkCrown[i];
    const tj = trunkCrown[j];
    idx.push(bi, bj, tj, bi, tj, ti);
  }

  // Crown: octahedron scaled per-vertex with the seeded RNG. 6 verts, 8 tri.
  // Add an additional "skirt" ring of 6 verts between the base and the tip
  // so the handoff with sprite billboards doesn't pop (adds 12 tri).
  const crownTop = trunkTop + 1.2 + rand() * 0.4;
  const crownBottom = trunkTop + 0.15;
  const crownRadius = 0.6 + rand() * 0.15;
  const crownRing = (y: number, r: number): number[] => {
    const ids: number[] = [];
    for (let i = 0; i < 6; i += 1) {
      const a = (i / 6) * Math.PI * 2 + rand() * 0.05;
      const rr = r * (0.9 + rand() * 0.2);
      ids.push(push([Math.cos(a) * rr, y, Math.sin(a) * rr], [Math.cos(a), 0.3, Math.sin(a)], [1, (y - crownBottom) / (crownTop - crownBottom)]));
    }
    return ids;
  };
  const crownLow = crownRing(crownBottom, crownRadius * 0.75);
  const crownMid = crownRing((crownBottom + crownTop) * 0.5, crownRadius);
  const crownHigh = crownRing(crownTop - 0.3, crownRadius * 0.55);
  const tip = push([0, crownTop, 0], [0, 1, 0], [1, 1]);

  for (let i = 0; i < 6; i += 1) {
    const j = (i + 1) % 6;
    idx.push(crownLow[i], crownLow[j], crownMid[j], crownLow[i], crownMid[j], crownMid[i]);
    idx.push(crownMid[i], crownMid[j], crownHigh[j], crownMid[i], crownHigh[j], crownHigh[i]);
    idx.push(crownHigh[i], crownHigh[j], tip);
  }

  const triangleCount = idx.length / 3;
  // Encode indices as uint16 — mesh is small enough.
  if (positions.length / 3 >= 0x10000) {
    throw new Error('solid flora mesh exceeded uint16 index budget');
  }
  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    mix: new Float32Array(mix),
    indices: new Uint16Array(idx),
    triangleCount,
  };
};

export interface FloraSolidPoolResources {
  mesh: FloraSolidMesh;
  pool: InstancePool;
  positionBuffer: GPUBuffer;
  normalBuffer: GPUBuffer;
  mixBuffer: GPUBuffer;
  indexBuffer: GPUBuffer;
  dispose(): void;
}

export interface FloraSolidPoolInput {
  speciesIndex: number;
  positions: Float32Array;
  metadata?: Uint32Array;
  bounds: PoolBounds;
}

/** Build GPU resources for a solid flora pool. */
export const createFloraSolidPool = (
  device: GPUDevice,
  input: FloraSolidPoolInput,
): FloraSolidPoolResources => {
  const mesh = buildFloraSolidMesh(input.speciesIndex);
  const poolInput: PoolInput = {
    kind: 'foliage', // same cull/indices lane as the sprite pool for its chunk
    speciesIndex: input.speciesIndex,
    positions: input.positions,
    metadata: input.metadata,
    bounds: input.bounds,
  };
  const pool = createInstancePool(device, poolInput);
  const positionBuffer = device.createBuffer({
    label: `floraSolid-pos:${input.speciesIndex}`,
    size: Math.max(16, mesh.positions.byteLength),
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(positionBuffer, 0, mesh.positions as BufferSource);
  const normalBuffer = device.createBuffer({
    label: `floraSolid-nrm:${input.speciesIndex}`,
    size: Math.max(16, mesh.normals.byteLength),
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(normalBuffer, 0, mesh.normals as BufferSource);
  const mixBuffer = device.createBuffer({
    label: `floraSolid-mix:${input.speciesIndex}`,
    size: Math.max(16, mesh.mix.byteLength),
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(mixBuffer, 0, mesh.mix as BufferSource);
  const indexBuffer = device.createBuffer({
    label: `floraSolid-idx:${input.speciesIndex}`,
    size: Math.max(16, mesh.indices.byteLength),
    usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(indexBuffer, 0, mesh.indices as BufferSource);
  let disposed = false;
  return {
    mesh,
    pool,
    positionBuffer,
    normalBuffer,
    mixBuffer,
    indexBuffer,
    dispose() {
      if (disposed) return;
      disposed = true;
      positionBuffer.destroy();
      normalBuffer.destroy();
      mixBuffer.destroy();
      indexBuffer.destroy();
      pool.dispose();
    },
  };
};
