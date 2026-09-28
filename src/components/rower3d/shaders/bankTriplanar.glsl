// The bank's triplanar grass/earth material, from #430.
//
// Vertex chunks follow `#include <begin_vertex>` and `#include <worldpos_vertex>`;
// the fragment chunk replaces `#include <map_fragment>`. `uGrass`/`uEarth` are
// the albedos from `createDetailTexture` (#353); no placeholders — the tile
// metres are inlined at 0.5 m in world space.

// @chunk:vertexDeclarations
attribute float shoreDist;
varying vec3 vBankWorldPos;
varying vec3 vBankWorldNormal;
varying float vBankShoreDist;

// @chunk:vertexAssign
// The transformed position is in local space; three's own `<worldpos_vertex>`
// stage writes `worldPosition` later, but the bank meshes are mounted at the
// identity model matrix (see `bankComponents.tsx`), so a plain modelMatrix
// multiply works both before and after the include.
vBankWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
vBankWorldNormal = normalize(mat3(modelMatrix) * normal);
vBankShoreDist = shoreDist;

// @chunk:fragmentDeclarations
uniform sampler2D uGrass;
uniform sampler2D uEarth;
varying vec3 vBankWorldPos;
varying vec3 vBankWorldNormal;
varying float vBankShoreDist;

// A triplanar sample of `t` at world position `pos`, tiled every 0.5 m and
// blended by the surface normal so a wall reads the vertical planes and a
// floor reads the horizontal one. `pow(|n|, 2)` sharpens the transition so
// a plane facing one way barely picks up the other two.
vec3 bankTriplanar(sampler2D t, vec3 pos, vec3 n) {
  vec3 blending = abs(n);
  blending = blending * blending;
  float total = blending.x + blending.y + blending.z + 1e-4;
  blending /= total;
  vec2 uvX = pos.zy / 0.5;
  vec2 uvY = pos.xz / 0.5;
  vec2 uvZ = pos.xy / 0.5;
  vec3 xa = texture2D(t, uvX).rgb;
  vec3 ya = texture2D(t, uvY).rgb;
  vec3 za = texture2D(t, uvZ).rgb;
  return xa * blending.x + ya * blending.y + za * blending.z;
}

// A two-phase sin/cos on a 64 m grid, mapped to `[0, 1]`. Non-axis-aligned
// so the peaks do not sit on a grid; deterministic so a test can iterate it.
float bankMacroNoise(vec2 p) {
  float a = sin(p.x * 6.28318) * cos(p.y * 6.28318);
  float b = sin((p.x + p.y) * 4.08 + 1.7);
  return 0.5 + 0.25 * (a + b);
}

// @chunk:mapReplacement
// `<map_fragment>` sets `diffuseColor` from a bound `map`; replace it so the
// bank picks its albedo from the triplanar grass/earth blend instead.
vec3 bankGrass = bankTriplanar(uGrass, vBankWorldPos, vBankWorldNormal);
vec3 bankEarth = bankTriplanar(uEarth, vBankWorldPos, vBankWorldNormal);
float bankSlope = smoothstep(0.3, 0.7, vBankWorldNormal.y);
vec3 bankAlbedo = mix(bankEarth, bankGrass, bankSlope);
float bankShore = smoothstep(0.0, 2.5, vBankShoreDist);
vec3 bankWet = bankEarth * 0.65;
bankAlbedo = mix(bankWet, bankAlbedo, bankShore);
float bankMacro = 0.85 + 0.25 * bankMacroNoise(vBankWorldPos.xz / 64.0);
bankAlbedo *= bankMacro;
diffuseColor.rgb *= bankAlbedo;
