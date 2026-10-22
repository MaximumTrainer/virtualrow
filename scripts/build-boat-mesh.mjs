#!/usr/bin/env node
/**
 * Build the baked boat + crew mesh buffer (#570 D1-b).
 *
 * Pure JS port of `buildBoatMesh` in `src/lib/renderer/plan/boatMesh.ts` —
 * emits the same interleaved vertex + index data to a tiny binary blob the
 * engine fetches at init. The procedural generator stays as a deterministic
 * fallback for test harnesses, SSR, and `fetch` failures: a parity test in
 * `boatMeshLoader.test.ts` asserts the two agree byte-for-byte.
 *
 * Output: `public/assets/boat/shell.bin`.
 * Layout (little-endian):
 *   - u32 vertexCount
 *   - u32 indexCount
 *   - vertexCount * 8 float32: interleaved vertex (pos3 norm3 bone1 weight1)
 *   - indexCount * uint16: triangle indices
 */
import { writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const FLOATS_PER_VERTEX = 8;
const BONE_HULL = 0;
const BONE_TORSO = 1;
const BONE_ARMS = 2;
const BONE_HEAD = 3;

const BOAT_LENGTH = 8.2;
const BOAT_BEAM = 0.46;
const BOAT_DEPTH = 0.22;

const push = (verts, x, y, z, nx, ny, nz) => {
  verts.push(x, y, z, nx, ny, nz, 0, 0);
};

const writeFace = (verts, indices, bone, weight, quad, corners) => {
  const a = corners[quad[0]];
  const b = corners[quad[1]];
  const c = corners[quad[2]];
  const d = corners[quad[3]];
  const ux = b[0] - a[0];
  const uy = b[1] - a[1];
  const uz = b[2] - a[2];
  const vx = c[0] - a[0];
  const vy = c[1] - a[1];
  const vz = c[2] - a[2];
  let nx = uy * vz - uz * vy;
  let ny = uz * vx - ux * vz;
  let nz = ux * vy - uy * vx;
  const len = Math.hypot(nx, ny, nz) || 1;
  nx /= len;
  ny /= len;
  nz /= len;
  const base = verts.length / FLOATS_PER_VERTEX;
  for (const corner of [a, b, c, d]) {
    push(verts, corner[0], corner[1], corner[2], nx, ny, nz);
  }
  const faceStart = verts.length - 4 * FLOATS_PER_VERTEX;
  for (let i = 0; i < 4; i++) {
    verts[faceStart + i * FLOATS_PER_VERTEX + 6] = bone;
    verts[faceStart + i * FLOATS_PER_VERTEX + 7] = weight;
  }
  indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
};

const addBox = (verts, indices, cx, cy, cz, sx, sy, sz, bone) => {
  const corners = [
    [cx - sx, cy - sy, cz - sz],
    [cx + sx, cy - sy, cz - sz],
    [cx + sx, cy + sy, cz - sz],
    [cx - sx, cy + sy, cz - sz],
    [cx - sx, cy - sy, cz + sz],
    [cx + sx, cy - sy, cz + sz],
    [cx + sx, cy + sy, cz + sz],
    [cx - sx, cy + sy, cz + sz],
  ];
  const faces = [
    [0, 1, 2, 3],
    [4, 7, 6, 5],
    [0, 3, 7, 4],
    [1, 5, 6, 2],
    [3, 2, 6, 7],
    [0, 4, 5, 1],
  ];
  for (const quad of faces) writeFace(verts, indices, bone, 1, quad, corners);
};

export const buildBoatMesh = () => {
  const hL = BOAT_LENGTH / 2;
  const bW = BOAT_BEAM / 2;
  const bD = BOAT_DEPTH / 2;
  const hullCorners = [
    [-0.04, bD * 0.6, -hL],
    [0.04, bD * 0.6, -hL],
    [0.04, -bD, -hL],
    [-0.04, -bD, -hL],
    [-bW, bD, 0],
    [bW, bD, 0],
    [bW, -bD, 0],
    [-bW, -bD, 0],
    [-0.04, bD * 0.6, hL],
    [0.04, bD * 0.6, hL],
    [0.04, -bD, hL],
    [-0.04, -bD, hL],
  ];
  const hullFaces = [
    [0, 1, 5, 4],
    [1, 2, 6, 5],
    [2, 3, 7, 6],
    [3, 0, 4, 7],
    [4, 5, 9, 8],
    [5, 6, 10, 9],
    [6, 7, 11, 10],
    [7, 4, 8, 11],
    [0, 3, 2, 1],
    [8, 9, 10, 11],
  ];
  const verts = [];
  const indices = [];
  for (const quad of hullFaces) writeFace(verts, indices, BONE_HULL, 1, quad, hullCorners);
  addBox(verts, indices, 0, 0.42, 0.0, 0.18, 0.26, 0.14, BONE_TORSO);
  addBox(verts, indices, 0, 0.52, 0.14, 0.26, 0.06, 0.08, BONE_ARMS);
  addBox(verts, indices, 0, 0.78, 0.0, 0.09, 0.09, 0.09, BONE_HEAD);
  return {
    vertices: new Float32Array(verts),
    indices: new Uint16Array(indices),
    vertexCount: verts.length / FLOATS_PER_VERTEX,
    indexCount: indices.length,
  };
};

export const packBoatMesh = ({ vertices, indices, vertexCount, indexCount }) => {
  const vertexBytes = vertices.byteLength;
  const indexBytes = indices.byteLength;
  const total = 8 + vertexBytes + indexBytes;
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint32(0, vertexCount, true);
  view.setUint32(4, indexCount, true);
  out.set(new Uint8Array(vertices.buffer, vertices.byteOffset, vertexBytes), 8);
  out.set(new Uint8Array(indices.buffer, indices.byteOffset, indexBytes), 8 + vertexBytes);
  return out;
};

const main = async () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const outPath = join(here, '..', 'public', 'assets', 'boat', 'shell.bin');
  const mesh = buildBoatMesh();
  const packed = packBoatMesh(mesh);
  await writeFile(outPath, packed);
  console.log(`wrote ${outPath} (${packed.byteLength} B, ${mesh.vertexCount} verts, ${mesh.indexCount / 3} tris)`);
};

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
