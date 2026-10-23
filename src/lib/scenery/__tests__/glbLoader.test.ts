import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { loadGlb, parseGlbContainer } from '../glbLoader';

const read = (file: string): Uint8Array =>
  new Uint8Array(readFileSync(path.join(process.cwd(), 'public/assets/scenery', file)));

describe('loadGlb', () => {
  it('reads the GLB container header and the two chunks', () => {
    const bytes = read('tier-a/a01-buoy-lane-sphere.glb');
    const { json, bin } = parseGlbContainer(bytes);
    expect(json.asset.version).toBe('2.0');
    expect(json.extensionsRequired).toContain('EXT_meshopt_compression');
    expect(json.extensionsRequired).toContain('KHR_mesh_quantization');
    expect(bin.length).toBeGreaterThan(0);
  });

  it('decodes a meshopt-compressed, quantized sphere into real-space positions', async () => {
    const bytes = read('tier-a/a01-buoy-lane-sphere.glb');
    const model = await loadGlb(bytes);
    expect(model.primitives.length).toBeGreaterThan(0);
    const prim = model.primitives[0];
    expect(prim.positions.length).toBeGreaterThan(0);
    expect(prim.normals.length).toBe(prim.positions.length);
    expect(prim.indices.length % 3).toBe(0);
    // After node-transform baking the extents should be in a sane real-space
    // range (metres-ish), not the raw int16 quantised range (−32767..32767).
    const absMax = Math.max(
      Math.abs(model.bounds.min[0]), Math.abs(model.bounds.min[1]), Math.abs(model.bounds.min[2]),
      Math.abs(model.bounds.max[0]), Math.abs(model.bounds.max[1]), Math.abs(model.bounds.max[2]),
    );
    expect(absMax).toBeGreaterThan(0.05);
    expect(absMax).toBeLessThan(500);
    // Base colour is in [0,1].
    for (const c of prim.baseColor) {
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThanOrEqual(1);
    }
  });

  it('reads a multi-primitive scenery GLB without throwing', async () => {
    const model = await loadGlb(read('tier-a/a09-gazebo-hexagonal.glb'));
    expect(model.primitives.length).toBeGreaterThan(1);
    // Positions should be finite (meshopt decode + dequantize both succeeded).
    for (const prim of model.primitives) {
      for (let i = 0; i < Math.min(90, prim.positions.length); i += 1) {
        expect(Number.isFinite(prim.positions[i])).toBe(true);
      }
    }
    // Non-trivial bounds.
    const extentX = model.bounds.max[0] - model.bounds.min[0];
    expect(extentX).toBeGreaterThan(0);
  });

  it('rejects a non-GLB file', () => {
    expect(() => parseGlbContainer(new Uint8Array([1, 2, 3, 4]))).toThrow();
  });
});
