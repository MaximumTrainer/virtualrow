import { describe, expect, it } from 'vitest';
import { buildFloraSolidMesh } from '../plan/floraSolidPool';

describe('floraSolidPool', () => {
  it('builds a mesh under the ~50 triangle budget (D7-a #562)', () => {
    for (let species = 0; species < 8; species += 1) {
      const mesh = buildFloraSolidMesh(species);
      expect(mesh.triangleCount).toBeGreaterThan(20);
      expect(mesh.triangleCount).toBeLessThanOrEqual(60);
    }
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
