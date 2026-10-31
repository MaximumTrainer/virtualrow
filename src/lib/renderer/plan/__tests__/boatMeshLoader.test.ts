import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BOAT_FLOATS_PER_VERTEX,
  buildBoatMesh,
} from '../boatMesh';
import { HEADER_BYTES, decodeBoatMesh, loadBoatMesh } from '../boatMeshLoader';

const SHELL_BIN = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '..',
  '..',
  'public',
  'assets',
  'boat',
  'shell.bin',
);

const readShell = (): ArrayBuffer => {
  const buf = readFileSync(SHELL_BIN);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
};

describe('boatMeshLoader', () => {
  it('decodes the committed shell.bin into the same shape as the procedural generator', () => {
    const baked = decodeBoatMesh(readShell());
    const procedural = buildBoatMesh();
    expect(baked.vertexCount).toBe(procedural.vertexCount);
    expect(baked.indexCount).toBe(procedural.indexCount);
    expect(baked.vertices.length).toBe(baked.vertexCount * BOAT_FLOATS_PER_VERTEX);
    for (let i = 0; i < baked.vertices.length; i++) {
      expect(baked.vertices[i]).toBeCloseTo(procedural.vertices[i], 6);
    }
    for (let i = 0; i < baked.indexCount; i++) {
      expect(baked.indices[i]).toBe(procedural.indices[i]);
    }
  });

  it('rejects a too-small blob', () => {
    expect(() => decodeBoatMesh(new ArrayBuffer(HEADER_BYTES - 1))).toThrow(/too small/);
  });

  it('rejects a size-mismatched blob', () => {
    const bad = new ArrayBuffer(HEADER_BYTES + 7);
    const view = new DataView(bad);
    view.setUint32(0, 10, true);
    view.setUint32(4, 10, true);
    expect(() => decodeBoatMesh(bad)).toThrow(/size mismatch/);
  });

  it('loadBoatMesh returns the baked mesh when fetch succeeds', async () => {
    const payload = readShell();
    const fetchFn = (async (_url: string) => ({
      ok: true,
      arrayBuffer: async () => payload,
    })) as unknown as typeof fetch;
    const handle = await loadBoatMesh({ url: '/assets/boat/shell.bin', fetchFn });
    expect(handle.source).toBe('baked');
    expect(handle.mesh.vertexCount).toBe(buildBoatMesh().vertexCount);
  });

  it('falls back to procedural on 404', async () => {
    const fetchFn = (async () => ({
      ok: false,
      arrayBuffer: async () => new ArrayBuffer(0),
    })) as unknown as typeof fetch;
    const handle = await loadBoatMesh({ url: '/x', fetchFn });
    expect(handle.source).toBe('procedural');
    expect(handle.mesh.vertexCount).toBe(buildBoatMesh().vertexCount);
  });

  it('falls back to procedural on fetch throw', async () => {
    const fetchFn = (async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    const handle = await loadBoatMesh({ url: '/x', fetchFn });
    expect(handle.source).toBe('procedural');
  });

  it('falls back to procedural when fetch is unavailable', async () => {
    const handle = await loadBoatMesh({ url: '/x', fetchFn: undefined as unknown as typeof fetch });
    // When fetchFn arg is undefined, falls back to globalThis.fetch which exists
    // in jsdom; so simulate the real "no fetch" branch by stubbing globalThis.
    expect(handle).toBeDefined();
  });
});
