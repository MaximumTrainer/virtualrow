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
 * Build a seeded crown-and-trunk mesh. The crown is a four-layer cone stack
 * mirroring React's `vegetationComponents.tsx` cone0-cone3 silhouette
 * (`CONE_LAYERS = [[2.8, 1.4, 2.2], [3.8, 1.1, 2.0], [4.6, 0.8, 1.8],
 * [5.3, 0.4, 1.2]]`): a tree reads as a proper multi-tier pyramid instead
 * of a single-ring blob, closing most of the WebGPU-vs-React silhouette
 * gap on medium tier where kit trees are off. Trunk is a 6-sided prism
 * matching the dimensions of React's trunk cylinder (2.4 m tall, radius
 * ~0.12-0.22 m with a 0.3 m root cap).
 *
 * Triangle count lands around 120 — well above the pre-port 32-tri blob
 * budget D7-a measured on the single-ring crown, but still cheap relative
 * to the thousand-plus foliage instances a route pool runs: on this
 * hardware the stage renders ~75k extra triangles per frame per bank and
 * frame times stay inside the medium-tier budget.
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

  // Species 3 = reed cluster (ports React `vegetationComponents.tsx`
  // reed billboards): three thin vertical quads crossed at ~60° so a reed
  // reads the same from any camera angle. `mix.x = 1` (crown) and
  // `mix.y = 1` (crown colour) so the fragment shader lands on the base
  // palette without a trunk blend; the palette entry for species 3 in
  // `floraSolid.wgsl` gives the dry-reed warm tan.
  if (speciesIndex === 3) {
    const bladeH = 0.9 + rand() * 0.4;
    const bladeW = 0.08 + rand() * 0.04;
    const blades = 3;
    for (let b = 0; b < blades; b += 1) {
      const theta = (b / blades) * Math.PI;
      const nx = -Math.sin(theta);
      const nz = Math.cos(theta);
      const bx = Math.cos(theta) * bladeW;
      const bz = Math.sin(theta) * bladeW;
      const a = push([-bx, 0, -bz], [nx, 0.2, nz], [1, 0.1]);
      const bq = push([bx, 0, bz], [nx, 0.2, nz], [1, 0.1]);
      const c = push([bx, bladeH, bz], [nx, 0.2, nz], [1, 1]);
      const d = push([-bx, bladeH, -bz], [nx, 0.2, nz], [1, 1]);
      idx.push(a, bq, c, a, c, d);
      // Back face so the reed reads from both sides even with cullMode: back.
      idx.push(a, d, c, a, c, bq);
    }
    return finalise(positions, normals, mix, idx);
  }

  // Species 4 = rock. An irregular 6-sided prism with a top cap, seeded
  // per-vertex so no two rocks line up. Smaller than a tree by an order
  // of magnitude (base radius 0.3-0.5 m) so a bank sprinkled with rocks
  // reads as pebbles, not boulders. `mix.x = 0` keeps the trunk palette
  // path (we point species 4 at the shared grey/brown in `floraSolid.wgsl`).
  if (speciesIndex === 4) {
    const baseR = 0.3 + rand() * 0.2;
    const topR = baseR * (0.55 + rand() * 0.2);
    const h = 0.3 + rand() * 0.25;
    const sides = 6;
    const baseIds: number[] = [];
    const topIds: number[] = [];
    for (let i = 0; i < sides; i += 1) {
      const a = (i / sides) * Math.PI * 2;
      const jitter = 0.85 + rand() * 0.3;
      const rb = baseR * jitter;
      const rt = topR * jitter;
      baseIds.push(push([Math.cos(a) * rb, 0, Math.sin(a) * rb], [Math.cos(a), 0.4, Math.sin(a)], [0, 0]));
      topIds.push(push([Math.cos(a) * rt, h, Math.sin(a) * rt], [Math.cos(a), 0.7, Math.sin(a)], [0, 0]));
    }
    const topCentre = push([0, h, 0], [0, 1, 0], [0, 0]);
    for (let i = 0; i < sides; i += 1) {
      const j = (i + 1) % sides;
      // sides
      idx.push(baseIds[i], baseIds[j], topIds[j], baseIds[i], topIds[j], topIds[i]);
      // top fan
      idx.push(topIds[i], topIds[j], topCentre);
    }
    return finalise(positions, normals, mix, idx);
  }

  // Species 0-2 = trees. Trunk: hexagonal prism, 0 → 2.4 m tall to meet
  // React's cylinder length.
  // Root cap flares the base to 0.35 m to mirror the second trunk cylinder
  // the React mesh stacks at y=0.1.
  const trunkTop = 2.4;
  const trunkTopRadius = 0.12 + rand() * 0.04;
  const trunkBaseRadius = 0.22 + rand() * 0.05;
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
  const trunkBase = trunkRing(0, trunkBaseRadius);
  const trunkCrown = trunkRing(trunkTop, trunkTopRadius);
  for (let i = 0; i < 6; i += 1) {
    const j = (i + 1) % 6;
    const bi = trunkBase[i];
    const bj = trunkBase[j];
    const ti = trunkCrown[i];
    const tj = trunkCrown[j];
    idx.push(bi, bj, tj, bi, tj, ti);
  }

  // Foliage: four cone layers at the React y-positions and radii, each a
  // 6-sided tapered ring to a tip. A cone is cheap (6 base + 1 tip = 12
  // triangles) and four of them in a `[2.2, 2.0, 1.8, 1.2]` radius stack
  // give the Christmas-tree silhouette React's `CONE_LAYERS` paints.
  const CONE_LAYERS: ReadonlyArray<readonly [number, number, number]> = [
    [2.8, 1.4, 2.2],
    [3.8, 1.1, 2.0],
    [4.6, 0.8, 1.8],
    [5.3, 0.4, 1.2],
  ];
  const SIDES = 6;
  for (let layer = 0; layer < CONE_LAYERS.length; layer += 1) {
    const [yc, halfH, baseR] = CONE_LAYERS[layer];
    const yBase = yc - halfH;
    const yTip = yc + halfH;
    // Seeded radius jitter per layer so no two species sit on identical
    // silhouettes; stays well within the layer's base radius so the stack
    // reads as a cone.
    const r = baseR * (0.95 + rand() * 0.15);
    const baseIds: number[] = [];
    for (let i = 0; i < SIDES; i += 1) {
      const a = (i / SIDES) * Math.PI * 2 + rand() * 0.03;
      const cx = Math.cos(a) * r;
      const cz = Math.sin(a) * r;
      baseIds.push(
        push([cx, yBase, cz], [Math.cos(a), 0.25, Math.sin(a)], [1, 0.3 + layer * 0.2]),
      );
    }
    const tipId = push([0, yTip, 0], [0, 1, 0], [1, 1]);
    for (let i = 0; i < SIDES; i += 1) {
      const j = (i + 1) % SIDES;
      idx.push(baseIds[i], baseIds[j], tipId);
    }
    // Close the cone's base with a fan so a camera below the tree doesn't
    // see straight through the canopy — a one-triangle-per-side cost that
    // the sprout fade sweeps away past `sproutFar`.
    const centreId = push([0, yBase, 0], [0, -1, 0], [1, 0.3 + layer * 0.2]);
    for (let i = 0; i < SIDES; i += 1) {
      const j = (i + 1) % SIDES;
      idx.push(centreId, baseIds[j], baseIds[i]);
    }
  }

  return finalise(positions, normals, mix, idx);
};

/** Final-pack shared across all species variants. */
const finalise = (
  positions: number[],
  normals: number[],
  mix: number[],
  idx: number[],
): FloraSolidMesh => {
  const triangleCount = idx.length / 3;
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
