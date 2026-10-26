/**
 * Shader-grass enable predicate parity (#496 Phase 2). Mirror of the React
 * `canvasSurface.ts` tests so a future flip of the default (or a tier
 * reshuffle) catches both engines at once.
 */

import { afterEach, describe, expect, it } from 'vitest';

import {
  drawsShaderGrass,
  isShaderGrassEnabled,
  shaderGrassStrengthFor,
} from '../shaderGrass';
import type { PerformanceMode } from '../../../scenery/sceneryPlacement';

const TIERS: PerformanceMode[] = ['basic', 'low', 'medium', 'high', 'extra-high'];

afterEach(() => {
  // Each case resets the global kill switch, since the predicate reads it
  // via `window.__VIRTUALROW_SHADER_GRASS` and leaking state is painful.
  delete (globalThis as unknown as { __VIRTUALROW_SHADER_GRASS?: boolean }).__VIRTUALROW_SHADER_GRASS;
});

describe('drawsShaderGrass — tier predicate', () => {
  it('is off on the two lowest tiers', () => {
    expect(drawsShaderGrass('basic')).toBe(false);
    expect(drawsShaderGrass('low')).toBe(false);
  });

  it('is on for medium, high and extra-high', () => {
    for (const t of ['medium', 'high', 'extra-high'] as const) {
      expect(drawsShaderGrass(t), t).toBe(true);
    }
  });
});

describe('isShaderGrassEnabled — kill switch', () => {
  it('defaults on for medium+ (undefined reads as on)', () => {
    expect(isShaderGrassEnabled('medium')).toBe(true);
    expect(isShaderGrassEnabled('high')).toBe(true);
    expect(isShaderGrassEnabled('extra-high')).toBe(true);
    expect(isShaderGrassEnabled('low')).toBe(false);
  });

  it('an explicit true keeps grass on, matching undefined', () => {
    (globalThis as unknown as { __VIRTUALROW_SHADER_GRASS?: boolean }).__VIRTUALROW_SHADER_GRASS = true;
    expect(isShaderGrassEnabled('medium')).toBe(true);
    expect(isShaderGrassEnabled('low')).toBe(false);
  });

  it('an explicit false turns grass off even on medium+', () => {
    (globalThis as unknown as { __VIRTUALROW_SHADER_GRASS?: boolean }).__VIRTUALROW_SHADER_GRASS = false;
    for (const t of TIERS) expect(isShaderGrassEnabled(t), t).toBe(false);
  });
});

describe('shaderGrassStrengthFor — tier scaling', () => {
  it('zero when the chunk is disabled, nonzero when it is on', () => {
    expect(shaderGrassStrengthFor('basic')).toBe(0);
    expect(shaderGrassStrengthFor('low')).toBe(0);
    expect(shaderGrassStrengthFor('medium')).toBeGreaterThan(0);
  });

  it('scales monotonically with tier where it is enabled', () => {
    expect(shaderGrassStrengthFor('high')).toBeGreaterThan(shaderGrassStrengthFor('medium'));
    expect(shaderGrassStrengthFor('extra-high')).toBeGreaterThan(shaderGrassStrengthFor('high'));
  });

  it('tops out at 1 so the shader never over-boosts', () => {
    for (const t of TIERS) {
      const s = shaderGrassStrengthFor(t);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(1);
    }
  });

  it('kill switch forces zero on every tier', () => {
    (globalThis as unknown as { __VIRTUALROW_SHADER_GRASS?: boolean }).__VIRTUALROW_SHADER_GRASS = false;
    for (const t of TIERS) expect(shaderGrassStrengthFor(t), t).toBe(0);
  });
});
