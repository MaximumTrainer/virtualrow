/**
 * The shared `sampleShadow` WGSL snippet is injected into lit passes at
 * build time (#559 D5-a). bank.wgsl / water.wgsl are parsed under
 * `src/lib/renderer/passes/__tests__/wgsl.test.ts`; this test asserts the
 * snippet strings themselves parse once wrapped in a minimal host shader,
 * so a syntax error in the shared snippet surfaces here with a clear
 * attribution rather than inside bank/water.
 */

import { describe, expect, it } from 'vitest';
import { WgslReflect } from 'wgsl_reflect/wgsl_reflect.module.js';
import {
  SAMPLE_SHADOW_WGSL,
  SHADOW_GROUP,
  SHADOW_UNIFORMS_WGSL,
} from '../shaderSnippets';

const HOST = /* wgsl */ `
@vertex fn vs_main() -> @builtin(position) vec4<f32> {
  return vec4<f32>(0.0);
}
@fragment fn fs_main() -> @location(0) vec4<f32> {
  let s = sampleShadow(vec3<f32>(0.0, 0.0, 0.0), 10.0);
  return vec4<f32>(s, s, s, 1.0);
}
`;

describe('shared shadow snippet', () => {
  it('parses when concatenated with a minimal host shader', () => {
    const src = SHADOW_UNIFORMS_WGSL + SAMPLE_SHADOW_WGSL + HOST;
    const reflect = new WgslReflect(src);
    const entries = reflect.functions.filter((f) =>
      f.attributes?.some((a) => ['vertex', 'fragment'].includes(a.name)),
    );
    expect(entries.length).toBeGreaterThanOrEqual(2);
  });

  it('binds the shadow group at index 1', () => {
    expect(SHADOW_GROUP).toBe(1);
    expect(SHADOW_UNIFORMS_WGSL).toContain('@group(1) @binding(0)');
    expect(SHADOW_UNIFORMS_WGSL).toContain('@group(1) @binding(1)');
    expect(SHADOW_UNIFORMS_WGSL).toContain('@group(1) @binding(2)');
  });

  it('uses hardware PCF via textureSampleCompareLevel', () => {
    expect(SAMPLE_SHADOW_WGSL).toContain('textureSampleCompareLevel');
    expect(SHADOW_UNIFORMS_WGSL).toContain('sampler_comparison');
    expect(SHADOW_UNIFORMS_WGSL).toContain('texture_depth_2d');
  });
});
