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
   - The transcoder lives in its own file (`ktx2Decoder.ts`) that
     `textureLoader.ts` dynamic-imports; Vite / Rollup split it into its
     own JS chunk — the engine's main chunk never pulls `basis_universal`
     unless a KTX2 asset is actually requested.
   - `basis_universal` + `ktx-parse` are **not** installed yet on this
     branch; the decoder returns `null` and the loader falls back to PNG.
     Wiring the real transcoder is parked in #556.

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

## Atlas authoring (future, parked in #556)

Today the atlas path is a stub: the loader asks for `/assets/flora/atlas.ktx2`
on `high`+ and `/assets/flora/atlas.png` otherwise. Neither file ships
yet — the smoke exercises the placeholder path, which still writes a
valid `__ROWER3D_TEXTURES.atlasBytes` from the expected mip chain.

When the atlas lands:

- Author at 512 × 512 with one row per species.
- Build-time transcode with `basisu` (`-ktx2 -uastc -mipmap`) into
  `assets/flora/atlas.ktx2`. Expected size ratio: BC7 ≈ ¼ of RGBA8.
- Ship the uncompressed `atlas.png` as the fallback for `medium` / `low` /
  `basic`.

Wiring the real decoder:

- `pnpm add -D basis_universal ktx-parse`.
- Replace the body of `decode()` in `engine/ktx2Decoder.ts` with a parse +
  transcode to BC7 bytes per mip level. The signature + return shape stay
  the same.

The lazy-chunk boundary is already enforced by the dynamic `import()` in
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

- Install `basis_universal` + `ktx-parse` and wire real KTX2 transcode.
- Author the 512×512 flora atlas with per-species rows and ship both
  the KTX2 and PNG assets.
- Replace the placeholder detail-texture binding on `bank.wgsl` with
  per-tier assets.
