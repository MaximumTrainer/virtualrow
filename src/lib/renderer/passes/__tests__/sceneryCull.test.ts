import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * #556 polish — scenery cull compute shader shape contract. The
 * `sceneryCullParity.test.ts` exercises the maths through a CPU
 * reference, which doesn't notice when the GPU-side aggregation
 * strategy changes. This test guards the WGSL structure directly: the
 * cull must count survivors in a workgroup-local atomic, reserve the
 * global range once per workgroup via a single `atomicAdd` on
 * `instanceCount`, and have each surviving thread write its index at
 * `global_base + local_slot`. Any shader change that reverts to the
 * pre-polish "one global atomicAdd per surviving thread" pattern trips
 * this test, since that pattern serialises 64 threads through the same
 * cache line and starves the scheduler on dense pools.
 */

const SHADER_PATH = path.join(
  process.cwd(),
  'src/lib/renderer/passes/sceneryCull.wgsl',
);

const shader = readFileSync(SHADER_PATH, 'utf8');

describe('sceneryCull.wgsl workgroup aggregation (#556 polish)', () => {
  it('declares a workgroup-local atomic survivor count', () => {
    expect(shader).toMatch(/var<workgroup>\s+local_count\s*:\s*atomic<u32>/);
  });

  it('declares a workgroup-local global base slot', () => {
    expect(shader).toMatch(/var<workgroup>\s+global_base\s*:\s*u32/);
  });

  it('increments the local counter per surviving thread', () => {
    expect(shader).toMatch(/atomicAdd\s*\(\s*&local_count\s*,\s*1u\s*\)/);
  });

  it('reserves the global range once per workgroup via a single atomicAdd on instanceCount', () => {
    // Thread 0 of the workgroup takes the sum of local_count and reserves
    // that many slots up-front; this is the one place we hit the global
    // atomic per group.
    expect(shader).toMatch(
      /global_base\s*=\s*atomicAdd\s*\(\s*&indirect\.instanceCount\s*,\s*cnt\s*\)/,
    );
    // And NOT the per-survivor global atomicAdd that the pre-polish
    // implementation used.
    expect(shader).not.toMatch(/atomicAdd\s*\(\s*&indirect\.instanceCount\s*,\s*1u\s*\)/);
  });

  it('writes the surviving instance id at global_base + local_slot', () => {
    expect(shader).toMatch(/indices\s*\[\s*global_base\s*\+\s*local_slot\s*\]\s*=\s*idx/);
  });

  it('uses two workgroupBarriers to fence (clear → count) and (count → reserve)', () => {
    const barrierCount = (shader.match(/workgroupBarrier\s*\(\s*\)/g) ?? []).length;
    expect(barrierCount).toBeGreaterThanOrEqual(2);
  });

  it('still runs with workgroup_size 64 (parity tests + draw sizes assume it)', () => {
    expect(shader).toMatch(/@compute\s+@workgroup_size\(\s*64\s*\)/);
  });
});
