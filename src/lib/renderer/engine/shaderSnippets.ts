/**
 * Shared WGSL snippets injected into the lit passes at module-build time
 * (#559 D5-a). WebGPU has no `#include`; a TS string concat keeps one
 * source of truth for the shadow-sampling helper the bank / water passes
 * (and future lit passes) call. #556 parks the preprocessor option.
 *
 * The `SHADOW_UNIFORMS_WGSL` + `SAMPLE_SHADOW_WGSL` pair is pasted after
 * each lit shader's `Frame` struct and before its vertex / fragment
 * entries. Pass authors use it by concatenation in TS:
 *
 *   const code = frameHeader + SHADOW_UNIFORMS_WGSL + SAMPLE_SHADOW_WGSL + body;
 *
 * The group / binding numbers are the engine's single contract — the lit
 * passes build their bind-group layouts to match.
 */

/**
 * `@group(1)` is the shadow bind group for lit passes with no other
 * per-draw group (bank / water). The scenery pass uses `@group(1)` for
 * its pool bindings and does not receive shadows in P4; shadow-casting
 * from foliage onto the ground is the AC9 win.
 */
export const SHADOW_GROUP = 1 as const;

/**
 * WGSL for the shadow uniform block + the atlas texture + comparison
 * sampler. Mirrors `ShadowUniforms` in `uniforms.ts`.
 */
export const SHADOW_UNIFORMS_WGSL = /* wgsl */ `
struct ShadowUniforms {
  cascadeViewProj: array<mat4x4<f32>, 4>,
  cascadeSplits: vec4<f32>,
  cascadeRadius: vec4<f32>,
  cascadeBlendStartRatio: f32,
  cascadeCount: u32,
  tileSize: f32,
  atlasWidth: f32,
};
@group(1) @binding(0) var<uniform> shadows: ShadowUniforms;
@group(1) @binding(1) var shadowAtlas: texture_depth_2d;
@group(1) @binding(2) var shadowCmp: sampler_comparison;
`;

/**
 * The shared `sampleShadow(worldPos, viewSpaceZ) -> f32` helper. Returns 1
 * = fully lit, 0 = fully shadowed. Picks the first cascade whose split
 * covers `viewSpaceZ`, blends into the next across
 * `cascadeBlendStartRatio` so there's no hard seam between cascades.
 *
 * Uses hardware PCF via `textureSampleCompareLevel` (D4-a).
 */
export const SAMPLE_SHADOW_WGSL = /* wgsl */ `
fn shadowAtlasUv(index: u32, lightUv: vec2<f32>) -> vec2<f32> {
  // atlas layout: tiles arranged horizontally; tileSize texels each.
  let tilesPerRow = f32(shadows.cascadeCount);
  let tileU = (f32(index) + lightUv.x) / tilesPerRow;
  return vec2<f32>(tileU, lightUv.y);
}

fn sampleCascade(index: u32, worldPos: vec3<f32>) -> f32 {
  let clip = shadows.cascadeViewProj[index] * vec4<f32>(worldPos, 1.0);
  // Expect orthographic — w is 1.
  let proj = clip.xyz / clip.w;
  if (proj.x < -1.0 || proj.x > 1.0 || proj.y < -1.0 || proj.y > 1.0) {
    return 1.0;
  }
  if (proj.z < -1.0 || proj.z > 1.0) {
    return 1.0;
  }
  let lightUv = vec2<f32>(proj.x * 0.5 + 0.5, 1.0 - (proj.y * 0.5 + 0.5));
  let atlasUv = shadowAtlasUv(index, lightUv);
  // depth maps have z range 0..1 after the viewport transform.
  let refDepth = proj.z * 0.5 + 0.5 - 0.0025;
  return textureSampleCompareLevel(shadowAtlas, shadowCmp, atlasUv, refDepth);
}

fn sampleShadow(worldPos: vec3<f32>, viewSpaceZ: f32) -> f32 {
  if (shadows.cascadeCount == 0u) {
    return 1.0;
  }
  // Pick the first cascade whose split covers viewSpaceZ.
  var idx: u32 = shadows.cascadeCount - 1u;
  for (var i: u32 = 0u; i < shadows.cascadeCount; i = i + 1u) {
    if (viewSpaceZ <= shadows.cascadeSplits[i]) {
      idx = i;
      break;
    }
  }
  let lit = sampleCascade(idx, worldPos);
  // Soft handoff into the next cascade.
  if (idx + 1u < shadows.cascadeCount) {
    let splitHere = shadows.cascadeSplits[idx];
    let splitPrev = select(0.0, shadows.cascadeSplits[idx - 1u], idx > 0u);
    let span = max(splitHere - splitPrev, 0.001);
    let blendStart = splitHere - span * (1.0 - shadows.cascadeBlendStartRatio);
    if (viewSpaceZ > blendStart) {
      let t = (viewSpaceZ - blendStart) / (splitHere - blendStart);
      let litNext = sampleCascade(idx + 1u, worldPos);
      return mix(lit, litNext, clamp(t, 0.0, 1.0));
    }
  }
  return lit;
}
`;
