/**
 * Procedural boat + crew mesh for the P7 passes (#570 D1 fallback & D2-a).
 *
 * The build-time path (D1-b, `scripts/build-boat-mesh.mjs`) emits the same
 * byte layout to `public/assets/boat/shell.bin`; the loader prefers the
 * baked buffer and this file is the deterministic fallback the engine uses
 * when the fetch is skipped (smoke pages, test harness, offline). The two
 * paths share the dimensions so the smoke's visual silhouette does not
 * depend on which one won.
 *
 * Layout — one interleaved vertex is 32 bytes:
 *   - position: vec3<f32> (12 B)
 *   - normal:   vec3<f32> (12 B)
 *   - boneIndex: u32 (4 B)
 *   - boneWeight: f32 (4 B)
 *
 * Bones (D2-a): 0 hull, 1 torso, 2 arms, 3 head. The hull is a static mesh
 * (bone 0 weight 1) and the crew is skinned (bones 1..3).
 */
/// <reference types="@webgpu/types" />

export const BOAT_FLOATS_PER_VERTEX = 8; // 32 B / 4
export const BOAT_BONE_COUNT = 4;
export const BOAT_BONE_HULL = 0;
export const BOAT_BONE_TORSO = 1;
export const BOAT_BONE_ARMS = 2;
export const BOAT_BONE_HEAD = 3;

export interface BoatMeshBuffers {
  /** Interleaved vertex buffer, LE floats. See the file header for layout. */
  vertices: Float32Array;
  /** Index buffer (uint16). */
  indices: Uint16Array;
  /** Vertex count. */
  vertexCount: number;
  /** Triangle index count. */
  indexCount: number;
}

const push = (
  verts: number[],
  x: number,
  y: number,
  z: number,
  nx: number,
  ny: number,
  nz: number,
): void => {
  // Reserve the bone / weight slots; `buildBoatMesh` writes them in a
  // second pass once it knows which bone each face belongs to.
  verts.push(x, y, z, nx, ny, nz, 0, 0);
};

const BOAT_LENGTH = 8.2; // metres — sculler shell
const BOAT_BEAM = 0.46;
const BOAT_DEPTH = 0.22;

/**
 * Build the hull as a tapered six-face prism and the single rower as four
 * oriented boxes (torso, arms, head, legs). Keeps the vertex count very low
 * — the smoke needs a silhouette, not fidelity — and lets `charactersDepth`
 * ride the same mesh without a second buffer.
 */
export const buildBoatMesh = (): BoatMeshBuffers => {
  // Hull: a long prism, nose at -z (forward), stern at +z. Taper the ends
  // so the silhouette reads as a shell rather than a block.
  const hL = BOAT_LENGTH / 2;
  const bW = BOAT_BEAM / 2;
  const bD = BOAT_DEPTH / 2;
  const hullCorners: Array<[number, number, number]> = [
    // ring of 8 points: nose top-left, top-right, bot-right, bot-left; stern same
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
  // Twelve faces, 2 tris each, with per-face normals.
  const hullFaces: Array<[number, number, number, number]> = [
    // nose -> midring
    [0, 1, 5, 4],
    [1, 2, 6, 5],
    [2, 3, 7, 6],
    [3, 0, 4, 7],
    // midring -> stern
    [4, 5, 9, 8],
    [5, 6, 10, 9],
    [6, 7, 11, 10],
    [7, 4, 8, 11],
    // caps
    [0, 3, 2, 1],
    [8, 9, 10, 11],
    // deck seat opening is skipped — closed shell is enough for the smoke.
  ];
  const verts: number[] = [];
  const indices: number[] = [];
  const writeFace = (
    bone: number,
    weight: number,
    quad: readonly [number, number, number, number],
    corners: readonly (readonly [number, number, number])[],
  ): void => {
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
    const base = verts.length / BOAT_FLOATS_PER_VERTEX;
    for (const corner of [a, b, c, d]) {
      push(verts, corner[0], corner[1], corner[2], nx, ny, nz);
    }
    // Bone + weight fill in the output buffer after `push` reserved slots.
    const perVertex = BOAT_FLOATS_PER_VERTEX;
    const faceStart = verts.length - 4 * perVertex;
    for (let i = 0; i < 4; i++) {
      verts[faceStart + i * perVertex + 6] = bone;
      verts[faceStart + i * perVertex + 7] = weight;
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  for (const quad of hullFaces) {
    writeFace(BOAT_BONE_HULL, 1, quad, hullCorners);
  }

  // Crew — one rower, 4 boxes. Each box is written with its bone index and
  // weight 1.0 against that bone. Keeps the WGSL skinning branchless.
  const addBox = (
    cx: number,
    cy: number,
    cz: number,
    sx: number,
    sy: number,
    sz: number,
    bone: number,
  ): void => {
    const corners: Array<[number, number, number]> = [
      [cx - sx, cy - sy, cz - sz],
      [cx + sx, cy - sy, cz - sz],
      [cx + sx, cy + sy, cz - sz],
      [cx - sx, cy + sy, cz - sz],
      [cx - sx, cy - sy, cz + sz],
      [cx + sx, cy - sy, cz + sz],
      [cx + sx, cy + sy, cz + sz],
      [cx - sx, cy + sy, cz + sz],
    ];
    const faces: Array<[number, number, number, number]> = [
      [0, 1, 2, 3],
      [4, 7, 6, 5],
      [0, 3, 7, 4],
      [1, 5, 6, 2],
      [3, 2, 6, 7],
      [0, 4, 5, 1],
    ];
    for (const quad of faces) writeFace(bone, 1, quad, corners);
  };
  // Rower sits above deck at y≈0.3, centred on z≈0.
  addBox(0, 0.42, 0.0, 0.18, 0.26, 0.14, BOAT_BONE_TORSO);
  addBox(0, 0.52, 0.14, 0.26, 0.06, 0.08, BOAT_BONE_ARMS);
  addBox(0, 0.78, 0.0, 0.09, 0.09, 0.09, BOAT_BONE_HEAD);

  const buf = new Float32Array(verts);
  const vertexCount = buf.length / BOAT_FLOATS_PER_VERTEX;
  return {
    vertices: buf,
    indices: new Uint16Array(indices),
    vertexCount,
    indexCount: indices.length,
  };
};
