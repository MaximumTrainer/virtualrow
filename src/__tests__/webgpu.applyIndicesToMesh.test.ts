import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { applyIndicesToMesh } from '../webgpu/applyIndicesToMesh';

const fakeMesh = (capacity: number) => {
  const array = new Float32Array(capacity * 16);
  const mesh = {
    count: 0,
    instanceMatrix: {
      array,
      needsUpdate: false,
      updateRanges: [] as { start: number; count: number }[],
      clearUpdateRanges() {
        this.updateRanges = [];
      },
      addUpdateRange(start: number, count: number) {
        this.updateRanges.push({ start, count });
      },
    },
  };
  return mesh as unknown as THREE.InstancedMesh & { instanceMatrix: typeof mesh.instanceMatrix };
};

const fillMatrices = (count: number): Float32Array => {
  // One identity-shaped matrix per instance; element [0] of each is `i + 1`
  // so a packed row is easy to read in assertions.
  const matrices = new Float32Array(count * 16);
  for (let i = 0; i < count; i += 1) {
    matrices[i * 16] = i + 1;
  }
  return matrices;
};

describe('applyIndicesToMesh (#498 Phase 2)', () => {
  it('packs visible matrices to the front of instanceMatrix in index order', () => {
    const mesh = fakeMesh(5);
    const matrices = fillMatrices(5);
    const written = applyIndicesToMesh(mesh, matrices, new Uint32Array([2, 0, 4]));
    expect(written).toBe(3);
    expect(mesh.count).toBe(3);
    const target = mesh.instanceMatrix.array;
    expect([target[0], target[16], target[32]]).toEqual([3, 1, 5]);
  });

  it('writes an empty count when no indices are visible', () => {
    const mesh = fakeMesh(3);
    const matrices = fillMatrices(3);
    applyIndicesToMesh(mesh, matrices, new Uint32Array([]));
    expect(mesh.count).toBe(0);
    expect(mesh.instanceMatrix.needsUpdate).toBe(true);
  });

  it('reports exactly one update range covering [0, count*16)', () => {
    const mesh = fakeMesh(5);
    const matrices = fillMatrices(5);
    applyIndicesToMesh(mesh, matrices, new Uint32Array([1, 3]));
    expect(mesh.instanceMatrix.updateRanges).toEqual([{ start: 0, count: 32 }]);
  });
});
