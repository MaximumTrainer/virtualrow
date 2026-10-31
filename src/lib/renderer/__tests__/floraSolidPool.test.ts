import { describe, expect, it } from 'vitest';
import { buildFloraSolidMesh } from '../plan/floraSolidPool';

describe('floraSolidPool', () => {
  it('builds trees (species 0-2) as a four-cone-stack mesh in the triangle budget', () => {
    // The pre-#591-fu single-ring crown ran at ~32 tris / tree with a 60-tri
    // cap; the four-cone stack (`CONE_LAYERS` from React
    // `vegetationComponents.tsx`) raises the per-tree cost accordingly. The
    // lower bound stays well above the old single-blob count so a future
    // simplification can't silently regress the silhouette.
    for (let species = 0; species < 3; species += 1) {
      const mesh = buildFloraSolidMesh(species);
      expect(mesh.triangleCount).toBeGreaterThanOrEqual(48);
      expect(mesh.triangleCount).toBeLessThanOrEqual(120);
    }
  });

  it('builds reed clusters (species 3) with crossed-blade triangles', () => {
    // Reeds are three crossed thin quads with both faces so they read from
    // either side under `cullMode: back` — that's 3 blades × 2 tris × 2
    // faces = 12 triangles.
    const mesh = buildFloraSolidMesh(3);
    expect(mesh.triangleCount).toBe(12);
  });

  it('builds rocks (species 4) as a 6-sided prism with a top fan', () => {
    // 6 sides × 2 tris + 6 top-fan tris = 18 triangles.
    const mesh = buildFloraSolidMesh(4);
    expect(mesh.triangleCount).toBe(18);
  });

  it('positions, normals, mix are same length (xyz vs xyz vs xy per vert)', () => {
    const mesh = buildFloraSolidMesh(0);
    const verts = mesh.positions.length / 3;
    expect(mesh.normals.length / 3).toBe(verts);
    expect(mesh.mix.length / 2).toBe(verts);
  });

  it('indices reference only valid verts', () => {
    const mesh = buildFloraSolidMesh(3);
    const verts = mesh.positions.length / 3;
    for (let i = 0; i < mesh.indices.length; i += 1) {
      expect(mesh.indices[i]).toBeLessThan(verts);
    }
  });

  it('mesh output is deterministic per species index', () => {
    const a = buildFloraSolidMesh(5);
    const b = buildFloraSolidMesh(5);
    expect(Array.from(a.positions)).toEqual(Array.from(b.positions));
    expect(Array.from(a.indices)).toEqual(Array.from(b.indices));
  });

  it('different species get different meshes', () => {
    const a = buildFloraSolidMesh(1);
    const b = buildFloraSolidMesh(2);
    expect(Array.from(a.positions)).not.toEqual(Array.from(b.positions));
  });
});
