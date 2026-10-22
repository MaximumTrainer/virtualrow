import { describe, expect, it } from 'vitest';
import {
  BOAT_BONE_ARMS,
  BOAT_BONE_COUNT,
  BOAT_BONE_HEAD,
  BOAT_BONE_HULL,
  BOAT_BONE_TORSO,
  BOAT_FLOATS_PER_VERTEX,
  buildBoatMesh,
} from '../boatMesh';

describe('boatMesh', () => {
  const mesh = buildBoatMesh();

  it('emits an interleaved vertex buffer at the declared stride', () => {
    expect(mesh.vertexCount).toBeGreaterThan(0);
    expect(mesh.vertices.length).toBe(mesh.vertexCount * BOAT_FLOATS_PER_VERTEX);
  });

  it('emits a triangle index buffer', () => {
    expect(mesh.indexCount).toBeGreaterThan(0);
    expect(mesh.indexCount % 3).toBe(0);
    for (let i = 0; i < mesh.indexCount; i++) {
      expect(mesh.indices[i]).toBeLessThan(mesh.vertexCount);
    }
  });

  it('bones are tagged within the declared bone count', () => {
    for (let i = 0; i < mesh.vertexCount; i++) {
      const bone = Math.round(mesh.vertices[i * BOAT_FLOATS_PER_VERTEX + 6]);
      expect(bone).toBeGreaterThanOrEqual(0);
      expect(bone).toBeLessThan(BOAT_BONE_COUNT);
    }
  });

  it('uses all four bones', () => {
    const bones = new Set<number>();
    for (let i = 0; i < mesh.vertexCount; i++) {
      bones.add(Math.round(mesh.vertices[i * BOAT_FLOATS_PER_VERTEX + 6]));
    }
    expect(bones).toContain(BOAT_BONE_HULL);
    expect(bones).toContain(BOAT_BONE_TORSO);
    expect(bones).toContain(BOAT_BONE_ARMS);
    expect(bones).toContain(BOAT_BONE_HEAD);
  });

  it('bone weights are 1.0 (hard-skinned, D2-a)', () => {
    for (let i = 0; i < mesh.vertexCount; i++) {
      const w = mesh.vertices[i * BOAT_FLOATS_PER_VERTEX + 7];
      expect(w).toBe(1);
    }
  });
});
