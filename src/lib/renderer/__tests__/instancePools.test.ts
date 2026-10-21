import { describe, expect, it } from 'vitest';
import { makeMockDevice } from './_mockWebGPU';
import {
  buildSmokeFoliagePools,
  createInstancePool,
  INSTANCE_STRIDE_FLOATS,
  packPoolCentres,
} from '../plan/instancePools';

describe('instancePools', () => {
  it('packs positions + metadata into interleaved vec4 slots', () => {
    const positions = new Float32Array([
      1, 2, 3,
      4, 5, 6,
      7, 8, 9,
    ]);
    const meta = new Uint32Array([0x11223344, 0x55667788, 0x99aabbcc]);
    const packed = packPoolCentres(positions, meta);
    expect(packed.instanceCount).toBe(3);
    expect(packed.centres.length).toBe(3 * INSTANCE_STRIDE_FLOATS);
    expect(packed.centres[0]).toBe(1);
    expect(packed.centres[1]).toBe(2);
    expect(packed.centres[2]).toBe(3);
    // Fourth lane carries the u32 bit pattern.
    const meta32 = new Uint32Array(packed.centres.buffer);
    expect(meta32[3]).toBe(0x11223344);
    expect(meta32[7]).toBe(0x55667788);
    expect(meta32[11]).toBe(0x99aabbcc);
  });

  it('packs zero when metadata is omitted', () => {
    const positions = new Float32Array([1, 2, 3, 4, 5, 6]);
    const packed = packPoolCentres(positions);
    const meta32 = new Uint32Array(packed.centres.buffer);
    expect(meta32[3]).toBe(0);
    expect(meta32[7]).toBe(0);
  });

  it('creates a pool with a uploaded centres buffer and tracks dispose', () => {
    const device = makeMockDevice();
    const pool = createInstancePool(device, {
      kind: 'foliage',
      speciesIndex: 2,
      chunkIndex: 1,
      positions: new Float32Array([0, 0, 0, 10, 0, -5]),
      bounds: { cx: 5, cy: 0, cz: -2.5, radius: 7 },
    });
    expect(pool.kind).toBe('foliage');
    expect(pool.speciesIndex).toBe(2);
    expect(pool.chunkIndex).toBe(1);
    expect(pool.instanceCount).toBe(2);
    expect(pool.bounds.radius).toBe(7);
    expect(pool.centresCpu.length).toBe(2 * INSTANCE_STRIDE_FLOATS);
    pool.dispose();
    pool.dispose(); // idempotent
    expect(device.__log.destroyedBuffers).toBe(1);
  });

  it('handles an empty pool without zero-sized buffer errors', () => {
    const device = makeMockDevice();
    const pool = createInstancePool(device, {
      kind: 'scenery',
      speciesIndex: 0,
      positions: new Float32Array(),
      bounds: { cx: 0, cy: 0, cz: 0, radius: 0 },
    });
    expect(pool.instanceCount).toBe(0);
    expect(pool.chunkIndex).toBe(0);
    pool.dispose();
  });

  it('builds a deterministic smoke foliage pool set', () => {
    const pools = buildSmokeFoliagePools({
      speciesCount: 2,
      chunkCount: 3,
      perChunk: 20,
    });
    expect(pools.length).toBe(6);
    const total = pools.reduce((n, p) => n + Math.floor(p.positions.length / 3), 0);
    expect(total).toBe(2 * 3 * 20);
    // Bounds enclose every centre (plus crown radius).
    for (const pool of pools) {
      const count = Math.floor(pool.positions.length / 3);
      for (let i = 0; i < count; i += 1) {
        const dx = pool.positions[i * 3] - pool.bounds.cx;
        const dz = pool.positions[i * 3 + 2] - pool.bounds.cz;
        expect(Math.hypot(dx, dz)).toBeLessThanOrEqual(pool.bounds.radius);
      }
    }
  });
});
