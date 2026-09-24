// The water's fragment surface: a second ripple layer, and fresnel (#324, #341).
//
// Replaces `#include <normal_fragment_maps>`, with the uniforms declared ahead
// of `void main()`. Placeholders filled by `waterSurfaceChunks`:
//
//   FRESNEL_F0        Schlick's F0 for water against air
//   FRESNEL_F0_INV    1 - F0, precomputed so the shader does not
//   FRESNEL_STRENGTH  how much of the grazing reflection to blend in

// @chunk:uniforms
uniform vec2 uRipple2Offset;
uniform float uRipple2Scale;

// @chunk:surface
#include <normal_fragment_maps>
#ifdef USE_NORMALMAP_TANGENTSPACE
  vec3 wSecond = texture2D(
    normalMap,
    vNormalMapUv * uRipple2Scale + uRipple2Offset
  ).xyz * 2.0 - 1.0;
  wSecond.xy *= normalScale;
  normal = normalize(normal + tbn * wSecond * 0.5);
#endif
float wFresnel = FRESNEL_F0 + FRESNEL_F0_INV *
  pow(1.0 - clamp(dot(normalize(vViewPosition), normal), 0.0, 1.0), 5.0);
diffuseColor.rgb = mix(
  diffuseColor.rgb,
  vec3(1.0),
  wFresnel * FRESNEL_STRENGTH
);
