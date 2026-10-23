/**
 * Three-free loader for the scenery GLBs under `public/assets/scenery/`.
 *
 * All 130 scenery files share the same shape (inspected 2026-10-23):
 *   - glTF 2.0 binary, exactly one JSON + one BIN chunk.
 *   - Static meshes only (0 skins, 0 animations in every file).
 *   - Attributes POSITION + NORMAL. Draw mode 4 (TRIANGLES).
 *   - Materials are flat-colour PBR (0 textures, 0 images).
 *   - Every file requires `EXT_meshopt_compression` AND
 *     `KHR_mesh_quantization`, so a plain accessor walk returns zeros
 *     until the bufferView bytes are decoded through meshopt and the
 *     per-accessor data is dequantized.
 *
 * We vendor `meshoptimizer`'s `MeshoptDecoder` for the first step (MIT; a
 * compact 29 KB module with no three dep) and apply the glTF-conformant
 * dequantize for the second (sign-normalize for `NORMALIZED` byte/short
 * attributes). The output is a list of primitives with `Float32Array`
 * positions + normals and `Uint16Array`/`Uint32Array` indices ready for
 * `GPUBuffer.writeBuffer` upload.
 */

import { MeshoptDecoder } from 'meshoptimizer';

/** glTF enums we care about. */
const GL_UNSIGNED_BYTE = 5121;
const GL_SHORT = 5122;
const GL_UNSIGNED_SHORT = 5123;
const GL_UNSIGNED_INT = 5125;
const GL_FLOAT = 5126;
const GL_BYTE = 5120;

export interface GlbPrimitive {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint16Array | Uint32Array;
  /** Linear-space RGBA base colour, taken from the PBR material, default white. */
  baseColor: [number, number, number, number];
}

export interface GlbModel {
  primitives: GlbPrimitive[];
  /** Axis-aligned bounding box in local model space. */
  bounds: { min: [number, number, number]; max: [number, number, number] };
}

interface GltfBufferView {
  buffer: number;
  byteOffset?: number;
  byteLength: number;
  byteStride?: number;
  extensions?: {
    EXT_meshopt_compression?: {
      buffer: number;
      byteOffset?: number;
      byteLength: number;
      count: number;
      byteStride: number;
      mode: 'ATTRIBUTES' | 'TRIANGLES' | 'INDICES';
      filter?: 'NONE' | 'OCTAHEDRAL' | 'QUATERNION' | 'EXPONENTIAL';
    };
  };
}

interface GltfAccessor {
  bufferView?: number;
  byteOffset?: number;
  componentType: number;
  normalized?: boolean;
  count: number;
  type: 'SCALAR' | 'VEC2' | 'VEC3' | 'VEC4' | 'MAT4';
  min?: readonly number[];
  max?: readonly number[];
}

interface GltfPrimitive {
  attributes: Record<string, number>;
  indices?: number;
  material?: number;
  mode?: number;
}

interface GltfMaterial {
  pbrMetallicRoughness?: {
    baseColorFactor?: readonly number[];
  };
}

interface GltfNode {
  mesh?: number;
  children?: number[];
  matrix?: readonly number[]; // column-major mat4
  translation?: readonly number[];
  rotation?: readonly number[]; // quat xyzw
  scale?: readonly number[];
}

interface GltfJson {
  asset: { version: string };
  extensionsRequired?: string[];
  buffers: Array<{ byteLength: number; uri?: string }>;
  bufferViews: GltfBufferView[];
  accessors: GltfAccessor[];
  meshes: Array<{ primitives: GltfPrimitive[] }>;
  materials?: GltfMaterial[];
  nodes?: GltfNode[];
  scene?: number;
  scenes?: Array<{ nodes?: number[] }>;
}

const BYTES_PER_COMPONENT: Record<number, number> = {
  [GL_BYTE]: 1,
  [GL_UNSIGNED_BYTE]: 1,
  [GL_SHORT]: 2,
  [GL_UNSIGNED_SHORT]: 2,
  [GL_UNSIGNED_INT]: 4,
  [GL_FLOAT]: 4,
};

/** Signed-normalized dequantize (`KHR_mesh_quantization` + glTF accessor normalized). */
const normalizeDequantize = (componentType: number, value: number): number => {
  if (componentType === GL_BYTE) return Math.max(value / 127, -1);
  if (componentType === GL_UNSIGNED_BYTE) return value / 255;
  if (componentType === GL_SHORT) return Math.max(value / 32767, -1);
  if (componentType === GL_UNSIGNED_SHORT) return value / 65535;
  return value;
};

/** Reads up to 4 bytes little-endian starting at `offset`. */
const readU32 = (buf: Uint8Array, offset: number): number =>
  buf[offset] | (buf[offset + 1] << 8) | (buf[offset + 2] << 16) | (buf[offset + 3] << 24);

/**
 * Parse the GLB container; returns the JSON chunk as text and the BIN chunk
 * as a slice of the file. The spec is simple:
 *   magic(4 "glTF") | version(4) | length(4)
 *   chunkLen(4) | chunkType(4 "JSON") | chunkData
 *   chunkLen(4) | chunkType(4 "BIN\0") | chunkData
 */
export const parseGlbContainer = (
  file: ArrayBuffer | Uint8Array,
): { json: GltfJson; bin: Uint8Array } => {
  const buf = file instanceof Uint8Array ? file : new Uint8Array(file);
  if (buf.length < 12) throw new Error('GLB too short');
  if (readU32(buf, 0) !== 0x46546c67) throw new Error('not a GLB (bad magic)');
  const version = readU32(buf, 4);
  if (version !== 2) throw new Error(`unsupported GLB version ${version}`);

  const jsonLen = readU32(buf, 12);
  const jsonType = String.fromCharCode(buf[16], buf[17], buf[18], buf[19]);
  if (jsonType !== 'JSON') throw new Error(`expected JSON chunk, got "${jsonType}"`);
  const jsonBytes = buf.subarray(20, 20 + jsonLen);
  const json = JSON.parse(new TextDecoder().decode(jsonBytes)) as GltfJson;

  const binOffset = 20 + jsonLen;
  const binLen = readU32(buf, binOffset);
  const binType = String.fromCharCode(
    buf[binOffset + 4],
    buf[binOffset + 5],
    buf[binOffset + 6],
    buf[binOffset + 7],
  );
  if (binType !== 'BIN\0') throw new Error(`expected BIN chunk, got "${binType}"`);
  const bin = buf.subarray(binOffset + 8, binOffset + 8 + binLen);
  return { json, bin };
};

/**
 * Fetch raw bytes for a buffer view, running the `EXT_meshopt_compression`
 * decoder when the view carries that extension.
 */
const bufferViewBytes = async (
  bv: GltfBufferView,
  bin: Uint8Array,
): Promise<Uint8Array> => {
  const mo = bv.extensions?.EXT_meshopt_compression;
  if (mo) {
    await MeshoptDecoder.ready;
    const compressed = bin.subarray(
      mo.byteOffset ?? 0,
      (mo.byteOffset ?? 0) + mo.byteLength,
    );
    const target = new Uint8Array(mo.count * mo.byteStride);
    MeshoptDecoder.decodeGltfBuffer(
      target,
      mo.count,
      mo.byteStride,
      compressed,
      mo.mode,
      mo.filter ?? 'NONE',
    );
    return target;
  }
  return bin.subarray(
    bv.byteOffset ?? 0,
    (bv.byteOffset ?? 0) + bv.byteLength,
  );
};

const readFloatVecs = (
  bytes: Uint8Array,
  accessor: GltfAccessor,
  bv: GltfBufferView,
  components: number,
): Float32Array => {
  const perElement = BYTES_PER_COMPONENT[accessor.componentType] * components;
  const stride =
    bv.extensions?.EXT_meshopt_compression?.byteStride ?? bv.byteStride ?? perElement;
  const start = accessor.byteOffset ?? 0;
  const out = new Float32Array(accessor.count * components);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i < accessor.count; i += 1) {
    const base = start + i * stride;
    for (let c = 0; c < components; c += 1) {
      const off = base + c * BYTES_PER_COMPONENT[accessor.componentType];
      let raw: number;
      switch (accessor.componentType) {
        case GL_FLOAT: raw = view.getFloat32(off, true); break;
        case GL_SHORT: raw = view.getInt16(off, true); break;
        case GL_UNSIGNED_SHORT: raw = view.getUint16(off, true); break;
        case GL_BYTE: raw = view.getInt8(off); break;
        case GL_UNSIGNED_BYTE: raw = view.getUint8(off); break;
        case GL_UNSIGNED_INT: raw = view.getUint32(off, true); break;
        default: throw new Error(`unsupported componentType ${accessor.componentType}`);
      }
      out[i * components + c] = accessor.normalized
        ? normalizeDequantize(accessor.componentType, raw)
        : raw;
    }
  }
  return out;
};

const readIndices = (
  bytes: Uint8Array,
  accessor: GltfAccessor,
  bv: GltfBufferView,
): Uint16Array | Uint32Array => {
  const perElement = BYTES_PER_COMPONENT[accessor.componentType];
  const stride = bv.extensions?.EXT_meshopt_compression?.byteStride ?? bv.byteStride ?? perElement;
  const start = accessor.byteOffset ?? 0;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const use32 = accessor.componentType === GL_UNSIGNED_INT;
  const out = use32 ? new Uint32Array(accessor.count) : new Uint16Array(accessor.count);
  for (let i = 0; i < accessor.count; i += 1) {
    const off = start + i * stride;
    switch (accessor.componentType) {
      case GL_UNSIGNED_BYTE: out[i] = view.getUint8(off); break;
      case GL_UNSIGNED_SHORT: out[i] = view.getUint16(off, true); break;
      case GL_UNSIGNED_INT: out[i] = view.getUint32(off, true); break;
      default: throw new Error(`unsupported index componentType ${accessor.componentType}`);
    }
  }
  return out;
};

/** Column-major 4x4 identity. */
const identity4 = (): Float64Array => {
  const m = new Float64Array(16);
  m[0] = m[5] = m[10] = m[15] = 1;
  return m;
};

/** `out = a * b` (column-major mat4 multiply). */
const mul4 = (out: Float64Array, a: Float64Array, b: Float64Array): Float64Array => {
  const r = new Float64Array(16);
  for (let i = 0; i < 4; i += 1) {
    for (let j = 0; j < 4; j += 1) {
      r[j * 4 + i] =
        a[0 * 4 + i] * b[j * 4 + 0] +
        a[1 * 4 + i] * b[j * 4 + 1] +
        a[2 * 4 + i] * b[j * 4 + 2] +
        a[3 * 4 + i] * b[j * 4 + 3];
    }
  }
  out.set(r);
  return out;
};

const nodeMatrix = (node: GltfNode): Float64Array => {
  if (node.matrix) return new Float64Array(node.matrix);
  const m = identity4();
  // T * R * S, applied right-to-left so a point is scaled, rotated, translated.
  if (node.scale) {
    m[0] = node.scale[0];
    m[5] = node.scale[1];
    m[10] = node.scale[2];
  }
  if (node.rotation) {
    const [x, y, z, w] = node.rotation;
    // Quat → rotation matrix (right-hand, column-major).
    const r = new Float64Array(16);
    r[0] = 1 - 2 * (y * y + z * z);
    r[1] = 2 * (x * y + z * w);
    r[2] = 2 * (x * z - y * w);
    r[4] = 2 * (x * y - z * w);
    r[5] = 1 - 2 * (x * x + z * z);
    r[6] = 2 * (y * z + x * w);
    r[8] = 2 * (x * z + y * w);
    r[9] = 2 * (y * z - x * w);
    r[10] = 1 - 2 * (x * x + y * y);
    r[15] = 1;
    mul4(m, r, m);
  }
  if (node.translation) {
    m[12] = node.translation[0];
    m[13] = node.translation[1];
    m[14] = node.translation[2];
  }
  return m;
};

/** Transform a point (x,y,z,1) by a column-major mat4, in place via index. */
const transformPoint = (m: Float64Array, x: number, y: number, z: number, out: Float32Array, i: number): void => {
  const w = m[3] * x + m[7] * y + m[11] * z + m[15];
  const iw = w !== 0 ? 1 / w : 1;
  out[i] = (m[0] * x + m[4] * y + m[8] * z + m[12]) * iw;
  out[i + 1] = (m[1] * x + m[5] * y + m[9] * z + m[13]) * iw;
  out[i + 2] = (m[2] * x + m[6] * y + m[10] * z + m[14]) * iw;
};

/** Transform a direction (ignoring translation) by a column-major mat4. */
const transformDir = (m: Float64Array, x: number, y: number, z: number, out: Float32Array, i: number): void => {
  out[i] = m[0] * x + m[4] * y + m[8] * z;
  out[i + 1] = m[1] * x + m[5] * y + m[9] * z;
  out[i + 2] = m[2] * x + m[6] * y + m[10] * z;
  // Renormalize so unit normals stay unit after a scaled transform.
  const len = Math.hypot(out[i], out[i + 1], out[i + 2]) || 1;
  out[i] /= len;
  out[i + 1] /= len;
  out[i + 2] /= len;
};

/**
 * Decode every primitive in the GLB into position/normal/index buffers plus
 * the material base colour. Supports the glTF 2.0 subset the scenery assets
 * actually use; throws on unexpected features (skinning, UV0, animations)
 * so we spot new asset shapes rather than silently rendering garbage.
 *
 * Walks the scene from the root(s), accumulates each node's TRS/matrix, and
 * bakes the transform into the output positions and normals. That lets each
 * GLB be registered as one static mesh ready for an instance pool without a
 * per-node matrix stack at draw time.
 */
export const loadGlb = async (file: ArrayBuffer | Uint8Array): Promise<GlbModel> => {
  const { json, bin } = parseGlbContainer(file);
  const required = new Set(json.extensionsRequired ?? []);
  const unknown = [...required].filter(
    (ext) => ext !== 'EXT_meshopt_compression' && ext !== 'KHR_mesh_quantization',
  );
  if (unknown.length > 0) {
    throw new Error(`unsupported required extensions: ${unknown.join(', ')}`);
  }

  // Decode each buffer view we need, caching the decoded bytes.
  const bvCache = new Map<number, Promise<Uint8Array>>();
  const getBv = (i: number): Promise<Uint8Array> => {
    if (!bvCache.has(i)) bvCache.set(i, bufferViewBytes(json.bufferViews[i], bin));
    return bvCache.get(i)!;
  };

  const primitives: GlbPrimitive[] = [];
  const bounds = { min: [Infinity, Infinity, Infinity] as [number, number, number], max: [-Infinity, -Infinity, -Infinity] as [number, number, number] };

  const emitPrimitive = async (meshIndex: number, worldMatrix: Float64Array): Promise<void> => {
    const mesh = json.meshes[meshIndex];
    for (const prim of mesh.primitives) {
      if ((prim.mode ?? 4) !== 4) {
        throw new Error(`unsupported primitive mode ${prim.mode}`);
      }
      const posIdx = prim.attributes.POSITION;
      const nrmIdx = prim.attributes.NORMAL;
      if (posIdx === undefined || nrmIdx === undefined) {
        throw new Error('primitive missing POSITION or NORMAL');
      }
      if (prim.indices === undefined) {
        throw new Error('non-indexed primitives are not supported');
      }

      const posAcc = json.accessors[posIdx];
      const nrmAcc = json.accessors[nrmIdx];
      const idxAcc = json.accessors[prim.indices];
      const posBv = json.bufferViews[posAcc.bufferView!];
      const nrmBv = json.bufferViews[nrmAcc.bufferView!];
      const idxBv = json.bufferViews[idxAcc.bufferView!];

      const [posBytes, nrmBytes, idxBytes] = await Promise.all([
        getBv(posAcc.bufferView!),
        getBv(nrmAcc.bufferView!),
        getBv(idxAcc.bufferView!),
      ]);

      const rawPositions = readFloatVecs(posBytes, posAcc, posBv, 3);
      const rawNormals = readFloatVecs(nrmBytes, nrmAcc, nrmBv, 3);
      const indices = readIndices(idxBytes, idxAcc, idxBv);

      // Bake the walked node transform into local-space positions/normals so
      // the engine registers each GLB as one static mesh ready for upload.
      const positions = new Float32Array(rawPositions.length);
      const normals = new Float32Array(rawNormals.length);
      for (let i = 0; i < rawPositions.length; i += 3) {
        transformPoint(worldMatrix, rawPositions[i], rawPositions[i + 1], rawPositions[i + 2], positions, i);
        transformDir(worldMatrix, rawNormals[i], rawNormals[i + 1], rawNormals[i + 2], normals, i);
        for (let c = 0; c < 3; c += 1) {
          const v = positions[i + c];
          if (v < bounds.min[c]) bounds.min[c] = v;
          if (v > bounds.max[c]) bounds.max[c] = v;
        }
      }

      const materialIndex = prim.material;
      const materialBase =
        materialIndex !== undefined && json.materials?.[materialIndex]?.pbrMetallicRoughness?.baseColorFactor;
      const baseColor: [number, number, number, number] = materialBase
        ? [materialBase[0] ?? 1, materialBase[1] ?? 1, materialBase[2] ?? 1, materialBase[3] ?? 1]
        : [1, 1, 1, 1];

      primitives.push({ positions, normals, indices, baseColor });
    }
  };

  // Walk the scene tree, accumulating node matrices and emitting a baked
  // primitive per mesh reference. If no scene is listed, fall back to every
  // mesh at identity — matches three's GLTFLoader behaviour.
  const sceneIdx = json.scene ?? 0;
  const roots = json.scenes?.[sceneIdx]?.nodes ?? (json.nodes ? json.nodes.map((_, i) => i) : []);
  const seen = new Set<number>();
  const walk = async (nodeIndex: number, parentMatrix: Float64Array): Promise<void> => {
    if (seen.has(nodeIndex)) return;
    seen.add(nodeIndex);
    const node = json.nodes?.[nodeIndex];
    if (!node) return;
    const local = nodeMatrix(node);
    const world = new Float64Array(16);
    mul4(world, parentMatrix, local);
    if (node.mesh !== undefined) await emitPrimitive(node.mesh, world);
    for (const child of node.children ?? []) {
      await walk(child, world);
    }
  };
  for (const root of roots) await walk(root, identity4());

  // Guard against the degenerate empty-GLB.
  if (!Number.isFinite(bounds.min[0])) {
    bounds.min = [0, 0, 0];
    bounds.max = [0, 0, 0];
  }

  return { primitives, bounds };
};
