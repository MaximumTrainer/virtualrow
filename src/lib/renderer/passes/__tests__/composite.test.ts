import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Shape contract for `composite.wgsl` — guards the per-feature touch-
 * points that other PRs on the look-and-feel track also edit so the
 * composite doesn't quietly lose a feature during a merge.
 *
 * Each case targets a specific feature-slice (listed in the inline
 * doc) rather than the shader as a whole; a feature that lands in a
 * later PR should extend this file with its own case rather than
 * replace an existing one.
 */

const SHADER = readFileSync(
  path.join(process.cwd(), 'src/lib/renderer/passes/composite.wgsl'),
  'utf8',
);

describe('composite.wgsl (post-fx shape contract)', () => {
  it('declares `lensDirtMul(uv)` returning f32 (#574 lens dirt)', () => {
    expect(SHADER).toMatch(/fn\s+lensDirtMul\s*\(\s*uv\s*:\s*vec2<f32>\s*\)\s*->\s*f32/);
  });

  it('multiplies the bloom sample by lensDirtMul(in.uv) before the strength scale (#574)', () => {
    // The bloom contribution must pass through the dirt mask; otherwise
    // the composite looks like a mathematical gaussian rather than a
    // lens-affected glow.
    expect(SHADER).toMatch(
      /textureSample\(bloom\s*,\s*samp\s*,\s*in\.uv\)\.rgb\s*\*\s*lensDirtMul\(in\.uv\)/,
    );
  });

  it('clamps the dirt swing to ±15 % of the bloom (constants 0.85 + avg * 0.3)', () => {
    // 0.85 + [0,1] * 0.3 = [0.85, 1.15]. If a future change widens the
    // swing past ~20 %, bloom-free fragments can start popping, so the
    // intent to keep it subtle lives here.
    expect(SHADER).toMatch(/return\s+0\.85\s*\+\s*avg\s*\*\s*0\.3\s*;/);
  });

  it('runs four hash-noise octaves so the pattern is non-repeating across the frame', () => {
    // Four `fract(sin(dot(...)) * ...)` lines is the signature.
    const matches = SHADER.match(/fract\s*\(\s*sin\s*\(\s*dot\s*\(/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(4);
  });
});
