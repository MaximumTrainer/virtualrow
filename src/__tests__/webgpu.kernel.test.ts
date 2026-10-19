import { describe, expect, it } from 'vitest';
import foliageCullSource from '../webgpu/shaders/foliageCull.wgsl?raw';

/**
 * Structural checks on the foliageCull.wgsl kernel. The GPU is the only thing
 * that compiles it (Playwright does, in the spike CI job), but a drift here
 * surfaces as a dispatch that silently writes nothing — exactly what caught
 * #298. Keep this cheap: a few shapes we rely on, not a parser.
 */
describe('foliageCull.wgsl structure (#498 FR2)', () => {
  it('declares the 64-wide workgroup', () => {
    expect(foliageCullSource).toContain('@workgroup_size(64)');
  });

  it('declares the four bind-group entries we expect', () => {
    expect(foliageCullSource).toMatch(/@group\(0\) @binding\(0\) var<uniform> uniforms/);
    expect(foliageCullSource).toMatch(
      /@group\(0\) @binding\(1\) var<storage, read> instanceCentres/,
    );
    expect(foliageCullSource).toMatch(
      /@group\(0\) @binding\(2\) var<storage, read_write> visibleIndices/,
    );
    expect(foliageCullSource).toMatch(
      /@group\(0\) @binding\(3\) var<storage, read_write> visibleCount: atomic<u32>/,
    );
  });

  it('carries D3-a: frustum + distance combined, in that order', () => {
    const distanceAt = foliageCullSource.indexOf('rangeSquared');
    const frustumAt = foliageCullSource.indexOf('insideFrustum');
    expect(distanceAt).toBeGreaterThan(0);
    expect(frustumAt).toBeGreaterThan(0);
    expect(distanceAt).toBeLessThan(frustumAt);
  });

  it('uses atomicAdd to compact into visibleIndices', () => {
    expect(foliageCullSource).toContain('atomicAdd(&visibleCount');
    expect(foliageCullSource).toContain('visibleIndices[slot] = i');
  });
});
