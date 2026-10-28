import { describe, expect, it } from 'vitest';
import { mergeSceneryPrimitives } from '../sceneryMeshBuffers';
import type { GlbPrimitive } from '../../../scenery/glbLoader';

const prim = (over: Partial<GlbPrimitive>): GlbPrimitive => ({
  positions: over.positions ?? new Float32Array([0, 0, 0]),
  normals: over.normals ?? new Float32Array([0, 1, 0]),
  indices: over.indices ?? new Uint16Array([0]),
  baseColor: over.baseColor ?? [1, 1, 1, 1],
});

describe('mergeSceneryPrimitives', () => {
  it('keeps each primitive its own colour (per-vertex), not primitive-0 for all', () => {
    // Two triangles: primitive 0 is "trunk brown", primitive 1 is "leaves green".
    const trunk = prim({
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), // 3 verts
      normals: new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0]),
      indices: new Uint16Array([0, 1, 2]),
      baseColor: [0.4, 0.26, 0.13, 1],
    });
    const leaves = prim({
      positions: new Float32Array([0, 2, 0, 1, 2, 0, 0, 3, 0]), // 3 verts
      normals: new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0]),
      indices: new Uint16Array([0, 1, 2]),
      baseColor: [0.1, 0.6, 0.15, 1],
    });

    const merged = mergeSceneryPrimitives([trunk, leaves]);

    // 6 vertices total → 24 colour floats (vec4 each).
    expect(merged.colors.length).toBe(24);
    // Expected values round-tripped through Float32 so the comparison is exact.
    const trunkRgba = Array.from(new Float32Array([0.4, 0.26, 0.13, 1]));
    const leavesRgba = Array.from(new Float32Array([0.1, 0.6, 0.15, 1]));
    // First 3 verts carry the trunk colour …
    expect(Array.from(merged.colors.slice(0, 4))).toEqual(trunkRgba);
    expect(Array.from(merged.colors.slice(4, 8))).toEqual(trunkRgba);
    expect(Array.from(merged.colors.slice(8, 12))).toEqual(trunkRgba);
    // … the next 3 carry the leaves colour (regression: the old code painted
    // all 6 with primitive-0's trunk colour).
    expect(Array.from(merged.colors.slice(12, 16))).toEqual(leavesRgba);
    expect(Array.from(merged.colors.slice(20, 24))).toEqual(leavesRgba);
  });

  it('concatenates positions/normals and offsets indices by each primitive vertex base', () => {
    const a = prim({
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      indices: new Uint16Array([0, 1, 2]),
    });
    const b = prim({
      positions: new Float32Array([5, 0, 0, 6, 0, 0, 5, 1, 0]),
      indices: new Uint16Array([0, 1, 2]),
    });
    const merged = mergeSceneryPrimitives([a, b]);
    expect(merged.positions.length).toBe(18);
    // Second primitive's indices are offset by the 3 vertices of the first.
    expect(Array.from(merged.indices)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('widens to Uint32 indices when a primitive already uses them', () => {
    const a = prim({ indices: new Uint16Array([0]) });
    const b = prim({ indices: new Uint32Array([0]) });
    const merged = mergeSceneryPrimitives([a, b]);
    expect(merged.indices).toBeInstanceOf(Uint32Array);
  });

  it('handles a single primitive', () => {
    const merged = mergeSceneryPrimitives([prim({
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      indices: new Uint16Array([0, 1, 2]),
      baseColor: [0.2, 0.2, 0.9, 1],
    })]);
    expect(merged.colors.length).toBe(12);
    expect(Array.from(merged.colors.slice(0, 4))).toEqual(Array.from(new Float32Array([0.2, 0.2, 0.9, 1])));
  });
});
