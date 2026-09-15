// ============================================================================
// MEASURING A GLB, AND CHECKING IT AGAINST WHAT IT WAS MEANT TO BE
//
// Every model in the scenery kit declares its real-world size in
// scripts/build_scenery.py — "dia 300mm", "6000 x 2400 x 450mm". Nothing
// checked that the GLB on disk actually came out that size, so a model could
// drift from its specification, or be regenerated at the wrong scale, and the
// only symptom would be a boathouse that looks wrong next to a boat.
//
// The measurement is free: glTF stores min/max on every position accessor, so
// a model's bounding box is in the JSON chunk and no mesh data has to be
// decoded (issue #232).
// ============================================================================

export interface Bounds {
  x: number;
  y: number;
  z: number;
}

interface GltfNode {
  mesh?: number;
  children?: number[];
  matrix?: number[];
  translation?: number[];
  rotation?: number[];
  scale?: number[];
}

interface GltfJson {
  meshes?: Array<{ primitives?: Array<{ attributes?: Record<string, number> }> }>;
  accessors?: Array<{ type?: string; min?: number[]; max?: number[] }>;
  nodes?: GltfNode[];
  scenes?: Array<{ nodes?: number[] }>;
  scene?: number;
}

const GLB_MAGIC = 0x46546c67;
const JSON_CHUNK = 0x4e4f534a;

/** The glTF JSON out of a GLB container. */
export const parseGlbJson = (glb: Buffer): GltfJson => {
  if (glb.length < 20 || glb.readUInt32LE(0) !== GLB_MAGIC) {
    throw new Error('not a GLB file');
  }
  const jsonLength = glb.readUInt32LE(12);
  if (glb.readUInt32LE(16) !== JSON_CHUNK) throw new Error('GLB has no JSON chunk');

  const raw = glb.subarray(20, 20 + jsonLength);
  let end = raw.length;
  while (end > 0 && (raw[end - 1] === 0 || raw[end - 1] === 0x20)) end -= 1;
  return JSON.parse(raw.subarray(0, end).toString('utf8')) as GltfJson;
};

/**
 * The model's bounding box, in whatever units it was authored in — millimetres
 * for this kit. Null when it has no geometry to measure.
 */
export const readGlbBounds = (glb: Buffer): Bounds | null => {
  const gltf = parseGlbJson(glb);
  const accessors = gltf.accessors ?? [];

  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  let measured = false;

  for (const mesh of gltf.meshes ?? []) {
    for (const primitive of mesh.primitives ?? []) {
      const accessor = accessors[primitive.attributes?.POSITION ?? -1];
      if (!accessor?.min || !accessor?.max) continue;
      measured = true;
      for (let axis = 0; axis < 3; axis += 1) {
        min[axis] = Math.min(min[axis], accessor.min[axis]);
        max[axis] = Math.max(max[axis], accessor.max[axis]);
      }
    }
  }

  return measured ? { x: max[0] - min[0], y: max[1] - min[1], z: max[2] - min[2] } : null;
};

export type DimKind = 'box' | 'diameter' | 'diameter-height';

export interface DeclaredDims extends Bounds {
  kind: DimKind;
}

const toMillimetres = (value: number, unit: string): number =>
  unit.toLowerCase() === 'm' ? value * 1000 : value;

/**
 * Read the size a model was specified at.
 *
 * The labels are written for a human reading a render — "dia 300mm",
 * "6000 x 2400 x 450mm", "span 24m x 4.5m wide" — so this reads the shapes
 * that actually occur and returns null for anything else rather than guessing.
 */
export const parseDeclaredDims = (label: string): DeclaredDims | null => {
  if (!label) return null;
  const text = label.toLowerCase();

  const diameter = text.match(/dia\s*([\d.]+)\s*(?:x\s*([\d.]+)\s*)?(mm|m)\b/);
  if (diameter) {
    const unit = diameter[3];
    const d = toMillimetres(Number(diameter[1]), unit);
    if (diameter[2]) {
      const h = toMillimetres(Number(diameter[2]), unit);
      return { x: d, y: d, z: h, kind: 'diameter-height' };
    }
    return { x: d, y: d, z: d, kind: 'diameter' };
  }

  const triple = text.match(/([\d.]+)\s*x\s*([\d.]+)\s*x\s*([\d.]+)\s*(mm|m)\b/);
  if (triple) {
    const unit = triple[4];
    return {
      x: toMillimetres(Number(triple[1]), unit),
      y: toMillimetres(Number(triple[2]), unit),
      z: toMillimetres(Number(triple[3]), unit),
      kind: 'box',
    };
  }

  const span = text.match(/span\s*([\d.]+)\s*(mm|m)\b/);
  if (span) {
    const length = toMillimetres(Number(span[1]), span[2]);
    return { x: length, y: 0, z: 0, kind: 'box' };
  }

  return null;
};

export interface DimComparison {
  withinTolerance: boolean;
  /** The axis that disagrees most, as a ratio of declared to actual. */
  worstAxis: 'x' | 'y' | 'z';
  worstRatio: number;
}

/** Generated geometry lands slightly off its nominal size; fillets and chamfers cost millimetres. */
const TOLERANCE = 0.2;

/**
 * Compare a measured model with what it was specified to be.
 *
 * Two allowances, both deliberate. A round model's "diameter" applies to both
 * horizontal axes, and its height is the only figure that stands alone. And a
 * box may be modelled along either horizontal axis — a 12 × 3 m dock is the
 * same dock rotated — so the horizontal pair is compared as a set.
 */
export const compareDims = (
  declared: DeclaredDims | null,
  actual: Bounds | null,
): DimComparison | null => {
  if (!declared || !actual) return null;

  const horizontalDeclared = [declared.x, declared.y].sort((a, b) => a - b);
  const horizontalActual = [actual.x, actual.y].sort((a, b) => a - b);

  const ratios: Array<{ axis: 'x' | 'y' | 'z'; ratio: number }> = [
    { axis: 'x', ratio: ratioOf(horizontalDeclared[0], horizontalActual[0]) },
    { axis: 'y', ratio: ratioOf(horizontalDeclared[1], horizontalActual[1]) },
  ];

  // A bare "dia" gives no separate height to check against.
  if (declared.kind !== 'diameter') {
    ratios.push({ axis: 'z', ratio: ratioOf(declared.z, actual.z) });
  }

  const worst = ratios.reduce((a, b) => (b.ratio > a.ratio ? b : a));
  return {
    withinTolerance: worst.ratio <= TOLERANCE,
    worstAxis: worst.axis,
    worstRatio: worst.ratio,
  };
};

/** Relative disagreement between a declared figure and a measured one. */
const ratioOf = (declared: number, actual: number): number => {
  if (declared === 0) return 0;
  return Math.abs(actual - declared) / declared;
};

/* ------------------------------------------------- world-space measuring --- */

type Matrix = number[];

const IDENTITY: Matrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/** Column-major multiply, matching glTF's convention. */
const multiply = (a: Matrix, b: Matrix): Matrix => {
  const out = new Array<number>(16).fill(0);
  for (let col = 0; col < 4; col += 1) {
    for (let row = 0; row < 4; row += 1) {
      let sum = 0;
      for (let k = 0; k < 4; k += 1) sum += a[k * 4 + row] * b[col * 4 + k];
      out[col * 4 + row] = sum;
    }
  }
  return out;
};

/** A node's own transform: an explicit matrix, or translation/rotation/scale. */
const localMatrix = (node: GltfNode): Matrix => {
  if (node.matrix?.length === 16) return node.matrix;

  const [tx, ty, tz] = node.translation ?? [0, 0, 0];
  const [qx, qy, qz, qw] = node.rotation ?? [0, 0, 0, 1];
  const [sx, sy, sz] = node.scale ?? [1, 1, 1];

  const x2 = qx + qx, y2 = qy + qy, z2 = qz + qz;
  const xx = qx * x2, xy = qx * y2, xz = qx * z2;
  const yy = qy * y2, yz = qy * z2, zz = qz * z2;
  const wx = qw * x2, wy = qw * y2, wz = qw * z2;

  return [
    (1 - (yy + zz)) * sx, (xy + wz) * sx, (xz - wy) * sx, 0,
    (xy - wz) * sy, (1 - (xx + zz)) * sy, (yz + wx) * sy, 0,
    (xz + wy) * sz, (yz - wx) * sz, (1 - (xx + yy)) * sz, 0,
    tx, ty, tz, 1,
  ];
};

const transformPoint = (m: Matrix, [x, y, z]: number[]): number[] => [
  m[0] * x + m[4] * y + m[8] * z + m[12],
  m[1] * x + m[5] * y + m[9] * z + m[13],
  m[2] * x + m[6] * y + m[10] * z + m[14],
];

export interface WorldBounds extends Bounds {
  min: number[];
  max: number[];
}

/**
 * The model's bounding box where its parts actually sit.
 *
 * Accessor min/max are in each mesh's own frame, so a part modelled about its
 * own pivot and placed by a node transform — an oar about its gate, say — reads
 * far smaller than it draws. Measuring the boat that way understated it by the
 * whole rigger span (issue #232).
 */
export const readGlbWorldBounds = (glb: Buffer, nodeFilter?: (name: string) => boolean): WorldBounds | null => {
  const gltf = parseGlbJson(glb);
  const nodes = gltf.nodes ?? [];
  const accessors = gltf.accessors ?? [];

  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  let measured = false;

  const visit = (index: number, parent: Matrix, inherited: boolean) => {
    const node = nodes[index];
    if (!node) return;
    const world = multiply(parent, localMatrix(node));

    // The exporter names a group and hangs the geometry on a `_part` child, so
    // a filter matches a subtree: name the Hull and its mesh is included.
    const named = (node as GltfNode & { name?: string }).name ?? '';
    const included = inherited || !nodeFilter || nodeFilter(named);

    const mesh = node.mesh != null ? gltf.meshes?.[node.mesh] : undefined;
    if (mesh && included) {
      for (const primitive of mesh.primitives ?? []) {
        const accessor = accessors[primitive.attributes?.POSITION ?? -1];
        if (!accessor?.min || !accessor?.max) continue;
        measured = true;
        // Every corner: a rotation turns the box, and only the corners bound it.
        for (let corner = 0; corner < 8; corner += 1) {
          const local = [
            corner & 1 ? accessor.max[0] : accessor.min[0],
            corner & 2 ? accessor.max[1] : accessor.min[1],
            corner & 4 ? accessor.max[2] : accessor.min[2],
          ];
          const point = transformPoint(world, local);
          for (let axis = 0; axis < 3; axis += 1) {
            min[axis] = Math.min(min[axis], point[axis]);
            max[axis] = Math.max(max[axis], point[axis]);
          }
        }
      }
    }

    for (const child of node.children ?? []) visit(child, world, included);
  };

  const roots = gltf.scenes?.[gltf.scene ?? 0]?.nodes ?? nodes.map((_, i) => i);
  for (const root of roots) visit(root, IDENTITY, false);

  return measured
    ? { min, max, x: max[0] - min[0], y: max[1] - min[1], z: max[2] - min[2] }
    : null;
};
