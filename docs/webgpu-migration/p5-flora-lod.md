# P5 — Flora LOD + texture pipeline (#562)

Branch: `phase/p5-flora-lod` → `next/svelte-webgpu`.

## What P5 adds

1. **Texture pipeline primitives** (`src/lib/renderer/engine/textures.ts`):
   - `uploadFromImageBitmap`, `uploadBc7`, `generateMips` (D5-a: a tiny vs/fs
     mip pipeline, portable across every WebGPU implementation — no `storage`
     texture format requirement).
   - `textureBytes` and `mipLevelCountFor` the atlas-ratio test calls.

2. **Lazy KTX2/Basis loader** (`src/lib/renderer/engine/textureLoader.ts` +
   `ktx2Decoder.ts`):
   - `loadFloraAtlas(device, tier, source)` picks between KTX2 (BC7) and
     uncompressed PNG from the tier (D4-a).
   - `highTierKtx2(tier) && supportsBc7(device)` gates the KTX2 branch:
     on a device without `texture-compression-bc` (common on older iGPUs
     and some mobile adapters) the loader falls through to the PNG, and
     `device.ts` only asks for the feature when the adapter has it.
   - The transcoder lives in its own file (`ktx2Decoder.ts`) that
     `textureLoader.ts` dynamic-imports; Vite / Rollup split it into its
     own JS chunk — the engine's main chunk never pulls the Basis
     runtime unless a KTX2 asset is actually requested.
   - The decoder uses the Khronos Basis Universal transcoder (Apache 2.0,
     https://github.com/BinomialLLC/basis_universal) vendored into
     `public/assets/basis/basis_transcoder.{js,wasm}`. Those files are a
     straight `cp` from `node_modules/three/examples/jsm/libs/basis/` —
     three.js is only a convenient packaging of the Khronos WASM module;
     no three code is pulled in. On any failure (no document, WASM
     blocked, UASTC file not valid) the decoder returns `null` and the
     loader falls through to PNG.

3. **Hybrid flora LOD**:
   - `plan/floraSolidPool.ts` builds a seeded ~50-tri crown+trunk per species
     (D7-a). Hexagonal prism trunk + three-ring crown + tip.
   - `passes/floraSolid.wgsl` + `.ts` draw it per instance via
     `drawIndexedIndirect`. The pass has its own cull-attach (shared
     culler, separate indirect) so the solid draw list doesn't collide
     with the sprite pool's.
   - `passes/scenery.wgsl` grows a complementary per-vertex sprout fade:
     sprites fade **in** above `sproutNear`; the solid pool fades **out**
     above `sproutFar`. Per-tier windows 6/8/10/12/15 m (D6-b).

4. **Telemetry** (`engine/telemetry.ts`):
   - `__ROWER3D_TEXTURES = { atlasKind, atlasBytes, mipsGenerated, transcodedMs }`.
   - `__ROWER3D_SCENERY` adds `spriteDraws`, `solidDraws`, `solidTriangles`.

## Frame-graph order

```
shadowStage → sky → bank → scenery (sprites) → floraSolid → water
```

Both scenery and floraSolid read the `sprout` uniform; the alpha-blended
cross-fade on both passes keeps the handoff soft at any tier.

## Atlas authoring

The atlas is a 512 × 512 PNG with the three foliage shapes
(`broadleaf`, `conifer`, `willow`) stacked as 170-px rows. The painter is a
Node port of the three-side `paintFoliage` in
`src/components/rower3d/foliageTexture.ts` — same seeded clumps, same trunk,
same grey-shaded tones that species colour multiplies in the material.

Two scripts own the pipeline:

- `scripts/build-flora-atlas.mjs` — paints the PNG using `sharp` and writes
  it to `public/assets/flora/atlas.png`.
- `scripts/build-ktx2.mjs` — invokes `node_modules/basis_universal/bin/basisu`
  with `-uastc -ktx2 -mipmap -y_flip -no_multithreading` and writes
  `atlas.ktx2` next to it.

`npm run build:flora-atlas` chains both. The committed artifacts under
`public/assets/flora/` are deterministic from one run to the next
(`-no_multithreading` + seeded painter), so the diff is bit-identical across
machines.

Current numbers (committed on this branch):

- `atlas.png` ≈ 183 KB (PNG, 512 × 512).
- `atlas.ktx2` ≈ 146 KB (UASTC, 10 mip levels).
- GPU memory for the full BC7 mip chain is ~349 KB; the uncompressed RGBA8
  chain is ~1.4 MB. BC7 is **~25 %** of RGBA8, well under the AC8 cap of
  50 % — asserted in `src/lib/renderer/__tests__/atlasBytes.test.ts`
  against the committed KTX2 file.

The lazy-chunk boundary is enforced by the dynamic `import()` in
`textureLoader.ts`; a Vite bundle test in `textureLoader.test.ts` keeps
future refactors honest.

## Verification

- `npm run verify` — 27 new unit tests across `textures.test.ts`,
  `textureLoader.test.ts`, `floraSolidPool.test.ts`, `floraLod.test.ts`
  (sprout window per-tier, pack layout, deterministic mesh output,
  BC7 ≈ ¼ RGBA8 ratio).
- `webgpu-flora-smoke.spec.ts` — Playwright smoke under `/smoke/flora`
  asserts `spriteDraws > 0`, `solidDraws > 0`, `solidTriangles > 0`,
  and the atlas kind is one of {ktx2, png, placeholder}.

## Deferred (#556)

- Replace the placeholder detail-texture binding on `bank.wgsl` with
  per-tier assets (D4-c; the bank still samples a solid colour today).
- Sample the committed atlas from `floraSolid.wgsl` and `scenery.wgsl`
  for per-species tinting (today the pass draws a species colour from
  the vertex stream; the atlas loads to prove the pipeline but no pass
  reads from it yet).
