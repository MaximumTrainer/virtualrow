// The bank's triplanar grass/earth material, from #430.
//
// Vertex chunks follow `#include <begin_vertex>` and `#include <worldpos_vertex>`;
// the fragment chunk replaces `#include <map_fragment>`. `uGrass`/`uEarth` are
// the albedos from `createDetailTexture` (#353); no placeholders — the tile
// metres are inlined at 0.5 m in world space.
//
// `grassDensityDeclarations` and `grassDensityModulation` are the #496 Phase 2
// chunks — spliced in only when the bank is handed a biome density tile. They
// read a baked density texture from `foliageTexture.ts` on a 32 m plan-view
// grid and modulate the grass's own albedo contribution so a wetland bank
// reads as lusher than a commercial one, with the slope-blended earth
// contribution left as it was.

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
uniform sampler2D uGrassN;
uniform sampler2D uEarthN;
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

// @chunk:grassDensityDeclarations
uniform sampler2D uBankGrassDensity;
uniform float uBankGrassDensityStrength;

// @chunk:grassDensityModulation
// `uBankGrassDensity` is the baked biome tile from `foliageTexture.ts`; its
// red channel holds the lushness. Sampled on a 32 m plan-view grid so one
// patch of the field covers a few boat-lengths of bank, then biased from
// `0.5` to `(target - 0.5)` so a biome whose mean density is below 0.5 reads
// drier and one above lusher. The modulation is only applied where
// `bankSlope` says the surface is a bank top (grass side of the blend); on
// steeper faces and the wet-earth shore it stays as it was.
vec2 bankDensityUv = vBankWorldPos.xz / 32.0;
float bankGrassDensity = texture2D(uBankGrassDensity, bankDensityUv).r;
float bankGrassBoost = mix(1.0, 0.72 + 0.56 * bankGrassDensity, uBankGrassDensityStrength);
float bankGrassWeight = bankSlope * bankShore;
diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * bankGrassBoost, bankGrassWeight);

// @chunk:normalReplacement
// `<normal_fragment_maps>` samples a bound `normalMap` and perturbs `normal`;
// replace it so the bank perturbs `normal` from the same triplanar
// grass/earth blend the albedo uses (#437). The two tangent-space normals are
// sampled with the same 0.5 m tiling and `abs(worldNormal)^2` weighting, then
// mixed by the slope and shore weights so a wet-earth strip lights as earth.
// The tangent space is approximated by the world-space perturbation itself —
// the banks are near-horizontal at every pixel where this material shows, and
// three's own `<normal_fragment_maps>` is a no-op here since no `normalMap` is
// bound (the `USE_NORMALMAP` define is not set).
vec3 bankGrassN = bankTriplanar(uGrassN, vBankWorldPos, vBankWorldNormal) * 2.0 - 1.0;
vec3 bankEarthN = bankTriplanar(uEarthN, vBankWorldPos, vBankWorldNormal) * 2.0 - 1.0;
vec3 bankBlendN = mix(bankEarthN, bankGrassN, bankSlope);
bankBlendN = mix(bankEarthN, bankBlendN, bankShore);
normal = normalize(normal + vec3(bankBlendN.x, 0.0, bankBlendN.y));
