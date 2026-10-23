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

  it('rejects a GLB whose magic is wrong', () => {
    const bad = new Uint8Array(12);
    bad.set([0x47, 0x6c, 0x54, 0x47]); // "GlTG" — close but not glTF.
    expect(() => parseGlbContainer(bad)).toThrow(/bad magic/);
  });

  it('rejects a GLB of an unknown version', () => {
    const bytes = read('tier-a/a01-buoy-lane-sphere.glb');
    const b = new Uint8Array(bytes); // own copy
    // Patch version field (bytes 4..7, little-endian) from 2 to 99.
    b[4] = 99;
    b[5] = 0;
    b[6] = 0;
    b[7] = 0;
    expect(() => parseGlbContainer(b)).toThrow(/unsupported GLB version/);
  });

  it('rejects a GLB whose required extensions include something we do not support', async () => {
    const bytes = read('tier-a/a01-buoy-lane-sphere.glb');
    const { json, bin } = parseGlbContainer(bytes);
    json.extensionsRequired = [...(json.extensionsRequired ?? []), 'KHR_draco_mesh_compression'];
    const patched = encodeGlb(json, bin);
    await expect(loadGlb(patched)).rejects.toThrow(/unsupported required extensions.*KHR_draco_mesh_compression/);
  });

  it('rejects a GLB whose primitives use a non-triangle mode', async () => {
    const bytes = read('tier-a/a01-buoy-lane-sphere.glb');
    const { json, bin } = parseGlbContainer(bytes);
    json.meshes[0].primitives[0].mode = 1; // LINES
    const patched = encodeGlb(json, bin);
    await expect(loadGlb(patched)).rejects.toThrow(/unsupported primitive mode/);
  });

  it('throws if a primitive drops POSITION or NORMAL', async () => {
    const bytes = read('tier-a/a01-buoy-lane-sphere.glb');
    const { json, bin } = parseGlbContainer(bytes);
    delete json.meshes[0].primitives[0].attributes.NORMAL;
    const patched = encodeGlb(json, bin);
    await expect(loadGlb(patched)).rejects.toThrow(/missing POSITION or NORMAL/);
  });

  it('throws on a non-indexed primitive', async () => {
    const bytes = read('tier-a/a01-buoy-lane-sphere.glb');
    const { json, bin } = parseGlbContainer(bytes);
    delete json.meshes[0].primitives[0].indices;
    const patched = encodeGlb(json, bin);
    await expect(loadGlb(patched)).rejects.toThrow(/non-indexed/);
  });

  it('defaults the material base colour to white when the primitive has none', async () => {
    const bytes = read('tier-a/a01-buoy-lane-sphere.glb');
    const { json, bin } = parseGlbContainer(bytes);
    delete json.meshes[0].primitives[0].material;
    const patched = encodeGlb(json, bin);
    const model = await loadGlb(patched);
    expect(model.primitives[0].baseColor).toEqual([1, 1, 1, 1]);
  });

  it('decodes a GLB with no `scene` field by walking every node from identity', async () => {
    const bytes = read('tier-a/a01-buoy-lane-sphere.glb');
    const { json, bin } = parseGlbContainer(bytes);
    delete json.scene;
    delete json.scenes;
    const patched = encodeGlb(json, bin);
    const model = await loadGlb(patched);
    expect(model.primitives.length).toBeGreaterThan(0);
  });
});

/** Re-encode a parsed GLB (json + bin) back into bytes. For edge-case tests only. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function encodeGlb(json: any, bin: Uint8Array): Uint8Array {
  const jsonText = JSON.stringify(json);
  const jsonBytes = new TextEncoder().encode(jsonText);
  // JSON chunk must be 4-byte-aligned, padded with spaces.
  const jsonPad = (4 - (jsonBytes.length & 3)) & 3;
  const jsonLen = jsonBytes.length + jsonPad;
  const binLen = bin.length + ((4 - (bin.length & 3)) & 3);
  const total = 12 + 8 + jsonLen + 8 + binLen;
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true);
  dv.setUint32(4, 2, true);
  dv.setUint32(8, total, true);
  dv.setUint32(12, jsonLen, true);
  out[16] = 0x4a; out[17] = 0x53; out[18] = 0x4f; out[19] = 0x4e; // "JSON"
  out.set(jsonBytes, 20);
  for (let i = 0; i < jsonPad; i += 1) out[20 + jsonBytes.length + i] = 0x20;
  const binHeaderOff = 20 + jsonLen;
  dv.setUint32(binHeaderOff, binLen, true);
  out[binHeaderOff + 4] = 0x42;
  out[binHeaderOff + 5] = 0x49;
  out[binHeaderOff + 6] = 0x4e;
  out[binHeaderOff + 7] = 0x00; // "BIN\0"
  out.set(bin, binHeaderOff + 8);
  return out;
}
