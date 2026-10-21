# P4 — Cascaded shadow maps + flora shadow depth pass

Lands cascaded shadow maps for the lit passes (bank, water) with foliage
as the primary caster. Replaces the three scene's `CSM` (`three/examples
/jsm/csm/CSM.js`, driven by `src/components/rower3d/CascadedShadows.tsx`)
with a three-free port that fits into the P2 frame graph.

Issues: [#559](https://github.com/MaximumTrainer/virtualrow/issues/559)
(scope + ACs), [#542](https://github.com/MaximumTrainer/virtualrow/issues/542)
(epic), [#556](https://github.com/MaximumTrainer/virtualrow/issues/556)
(deferred items). Decisions locked by Dan 2026-10-21: D1-a, D2-a, D3-a,
D4-a, D5-a, D6-a, D7-a.

## Pipeline

```
shadowStage ─▶ sky ─▶ bank ─▶ scenery ─▶ water
    │
    ├─ for each cascade i in [0..N):
    │   setViewport(i * tileSize, 0, tileSize, tileSize)
    │   setScissorRect(...)
    │   render: bankDepth.wgsl       (one draw)
    │   render: sceneryDepth.wgsl    (one indirect-friendly draw per pool)
    │
    └─ writes atlas (depth32float, N tiles wide × tileSize tall)
```

The shadow stage sits at the head of the pass list so bank / water can
sample the atlas when they encode. Only one `queue.submit` per frame —
the frame graph still owns submit (P2 invariant).

## Cascades (D1-a / D2-a)

`practicalSplits(near, far, N, lambda=0.5)` matches three-csm's
`mode: 'practical'` (log + uniform mix). Per-tier counts and atlas sizes:

| Tier       | Cascades | Atlas tile |
|------------|---------:|-----------:|
| basic      |        2 |        512 |
| low        |        2 |       1024 |
| medium     |        3 |       1024 |
| high       |        3 |       2048 |
| extra-high |        4 |       2048 |

All tiers stay inside the 2048 × 2048 limit SwiftShader supports in CI.

## Atlas (D3-a)

A single `depth32float` texture, tiled horizontally — one tile per
cascade — bound as `texture_depth_2d`. Per-cascade viewport scissors
split the atlas during the depth pass. The lit passes read it with a
`sampler_comparison` and `textureSampleCompareLevel` (hardware PCF, D4-a).

## Shared sampling (D5-a)

`src/lib/renderer/engine/shaderSnippets.ts` exports two WGSL strings —
`SHADOW_UNIFORMS_WGSL` + `SAMPLE_SHADOW_WGSL` — that each lit pass
concatenates into its shader at build time. One source of truth; no WGSL
preprocessor. A dedicated Vitest wraps the snippet in a minimal host
shader so a syntax error attributes to the shared snippet rather than to
bank/water.

The snippet picks the first cascade whose view-space Z covers the
fragment and blends into the next across `cascadeBlendStartRatio` so
there's no visible seam.

## Receivers (D6-a / FR5)

bank + water sample the atlas. Scenery does **not** receive shadows in
P4 — foliage casting onto the ground is the AC9 win and matches the
three scene's behaviour. The scenery pass keeps `@group(1)` for its
pool bindings; the lit passes use `@group(1)` for shadow bindings.

## Caster: flora depth (FR4)

`src/lib/renderer/passes/sceneryDepth.ts` indexes the pool's
`centresBuffer` via `instance_index` and emits a quad whose depth is
written to the atlas. Alpha-tested with a procedural crown mask against
`ALPHA_CUTOFF = 0.5` so sparse-crowns don't produce blocky shadows. No
sway — the atlas stays stable frame-to-frame (shimmer-reduction, FR8).

Bank casts onto itself via `bankDepth.wgsl` (same geometry, depth-only).

## Telemetry

The engine writes two new globals every frame:

- `__ROWER3D_SHADOWS = { cascades, atlasSize, drawsPerCascade,
  lastSplits, draws, triangles, atlasBytes }`.
- `__ROWER3D_RENDER_STATS.shadowDraws`,
  `.shadowTriangles`, `.shadowAtlasBytes` (shape-compatible with the
  three-side telemetry on `main`).

A Playwright smoke under `playwright/tests/webgpu-shadows-smoke.spec.ts`
loads the hidden `/smoke/shadows` route and asserts the atlas is non-
empty, the splits are strictly increasing, and `shadowDraws > 0`.

## Deferred

Parked in #556:

- Variance shadow maps (VSM) and PCSS softening.
- Baked occluders beyond the view frustum.
- Shadow fade-out when the sun is low (uses `sunDir`).
- Preprocessor for WGSL `#include` to replace the string concat.
- Separate shadow caster index buffers (currently sceneryDepth
  dispatches a non-indexed draw per pool using `instance_index`).
