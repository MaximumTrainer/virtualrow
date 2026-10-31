/**
 * Merge a GLB model's primitives into the single vertex/index/colour set the
 * scenery-mesh pass draws per instance.
 *
 * The GLB kit is flat-colour PBR (one `baseColor` per primitive, no textures).
 * glTF splits a model into one primitive per material — trunk vs leaves, walls
 * vs roof vs windows — so a faithful render needs each primitive's own colour.
 * The engine draws a model as one instanced mesh, so we bake the per-primitive
 * colour into a per-VERTEX colour attribute here rather than carrying a single
 * uniform colour (which collapsed every part to primitive-0's colour and made
 * buildings/landform read as one pale block).
 */

import type { GlbPrimitive } from '../../scenery/glbLoader';

export interface MergedSceneryMesh {
  /** Interleaved vec3, all primitives concatenated. */
  positions: Float32Array;
  /** Interleaved vec3, matching `positions`. */
  normals: Float32Array;
  /** Indices offset per primitive by its vertex base. */
  indices: Uint16Array | Uint32Array;
  /** vec4 per vertex: the owning primitive's `baseColor`. */
  colors: Float32Array;
}

/**
 * Brightness gain applied to the tier-E vegetation GLBs' albedos.
 *
 * The kit's tree/ground-cover GLBs carry physically-correct LINEAR base
 * colours (leaf ≈ [0.05, 0.15, 0.03], trunk ≈ [0.10, 0.07, 0.04]). The scene
 * renders to an HDR target and the composite's ACES tone-map has a shallow
 * slope near zero, so those low linear values are crushed toward black — a
 * sunlit GLB oak leaf lands around g ≈ 0.21 and a shadowed one near g ≈ 0.06,
 * so the detailed kit trees read as dark muddy blobs next to the procedural
 * flora, whose palettes are authored ~6–10× brighter (crown ≈ [0.42, 0.60,
 * 0.30]) and tone-map to a clear green. Lifting the vegetation albedos into
 * the same effective range makes the two tree systems match: green leaves +
 * brown trunks instead of near-black.
 *
 * Scoped to tier-E (vegetation/ground-cover) only — buildings (tier-D) carry
 * a mix of already-bright surfaces (clapboard walls ≈ 0.78–0.91) that a
 * blanket gain would blow out.
 */
export const VEGETATION_ALBEDO_GAIN = 3.5;

/**
 * Scale a merged mesh's per-vertex RGB by `gain`, leaving alpha untouched.
 * Pure — returns a new buffer so callers can keep the raw colours for the
 * depth/shadow path. Values may exceed 1; the HDR target carries them and the
 * tone-map brings them back into range.
 */
export const scaleMeshColors = (colors: Float32Array, gain: number): Float32Array => {
  const out = new Float32Array(colors.length);
  for (let i = 0; i + 3 < colors.length; i += 4) {
    out[i] = colors[i] * gain;
    out[i + 1] = colors[i + 1] * gain;
    out[i + 2] = colors[i + 2] * gain;
    out[i + 3] = colors[i + 3];
  }
  return out;
};

export const mergeSceneryPrimitives = (
  primitives: readonly GlbPrimitive[],
): MergedSceneryMesh => {
  let posTotal = 0;
  let nrmTotal = 0;
  let idxTotal = 0;
  for (const p of primitives) {
    posTotal += p.positions.length;
    nrmTotal += p.normals.length;
    idxTotal += p.indices.length;
  }
  const vertexCount = posTotal / 3;

  const positions = new Float32Array(posTotal);
  const normals = new Float32Array(nrmTotal);
  const colors = new Float32Array(vertexCount * 4);
  // 16-bit indices overflow once the merged model passes 65 536 vertices, so
  // widen if any primitive already needs 32-bit or the merged count demands it.
  const needs32 =
    vertexCount > 65535 || primitives.some((p) => p.indices instanceof Uint32Array);
  const indices = needs32 ? new Uint32Array(idxTotal) : new Uint16Array(idxTotal);

  let pOff = 0;
  let nOff = 0;
  let iOff = 0;
  let cOff = 0;
  let vertBase = 0;
  for (const p of primitives) {
    positions.set(p.positions, pOff);
    normals.set(p.normals, nOff);
    for (let i = 0; i < p.indices.length; i += 1) indices[iOff + i] = p.indices[i] + vertBase;
    const primVerts = p.positions.length / 3;
    const [r, g, b, a] = p.baseColor;
    for (let v = 0; v < primVerts; v += 1) {
      colors[cOff] = r;
      colors[cOff + 1] = g;
      colors[cOff + 2] = b;
      colors[cOff + 3] = a;
      cOff += 4;
    }
    pOff += p.positions.length;
    nOff += p.normals.length;
    iOff += p.indices.length;
    vertBase += primVerts;
  }

  return { positions, normals, indices, colors };
};
