# P3 — GPU-driven scenery (compute cull + indirect draws)

Lands the WebGPU scenery pipeline behind the P2 frame graph. Replaces the
three scene's CPU `cullTo` (`src/components/rower3d/foliageComponents.tsx`)
with a per-pool compute kernel that writes a compact instance list, consumed
by `drawIndirect`.

Issues: [#555](https://github.com/MaximumTrainer/virtualrow/issues/555)
(scope + ACs), [#542](https://github.com/MaximumTrainer/virtualrow/issues/542)
(epic), [#556](https://github.com/MaximumTrainer/virtualrow/issues/556)
(deferred items). Decisions locked by Dan 2026-10-21: D1-a, D2-c, D3-c,
D4-a, D5-b, D6-a, D7-a.

## Pipeline

```
sky  ─▶ bank  ─▶  scenery  ─▶  water
                 │
                 ├─ compute: sceneryCull.wgsl  (@workgroup_size(64))
                 │   per pool → writes {indices, indirect}
                 │
                 └─ render: scenery.wgsl
                     per pool → drawIndirect(indirect)
```

The scenery pass sits between `bank` and `water` in `createFrameGraph`'s
list (see `src/lib/renderer/engine/attach.ts`). Each pool contributes one
compute dispatch and one indirect draw per frame.

## Pool layout (D1-a)

Each pool stores its instance centres in one `storage` buffer of
`vec4<f32>`:

```
┌──────────────────────────────┐
│ x (f32) │ y (f32) │ z (f32) │ meta (bitcast<u32>) │
└──────────────────────────────┘
```

Metadata is packed into the fourth lane. P3 packs `(swaySeed << 16) |
speciesIndex` and reinterprets with `bitcast<u32>()` in the WGSL. The pool
is a plain CPU-side struct (`InstancePool` in
`src/lib/renderer/plan/instancePools.ts`); the full three-side placement
port (`sceneryPlacement`, `batchFoliageChunked`, course furniture) remains
on the three scene until P5/P6 — the engine accepts a `SceneryRoute` with a
primitive `PoolInput[]`, which the smoke route builds synthetically today.

## Cull kernel (D2-c)

`sceneryCull.wgsl`:

- Uniform block: 6 Hessian-form frustum planes, `camPos.xyz + maxDistance`,
  pool bounds (`cx, cy, cz, radius`), draw args (`indexCount, baseVertex,
  firstIndex, _`).
- Per-thread test: xz-distance to camera + sphere-in-frustum against the
  pool's crown radius.
- Survivors are appended to `indices[]` via `atomicAdd(&indirect.instanceCount,
  1)` on an `IndirectDrawArgs` struct.

Hi-Z image-space culling is deferred to #556 (D2-c).

## Draw path (D3-c)

`scenery.wgsl` expands each surviving instance into two crossed quads using
`@builtin(vertex_index)` + `@builtin(instance_index)` lookups into
`centres[]` via the compact `indices[]`. One `drawIndirect` call per pool —
multi-draw merging is parked in #556 (D3-c) until WebGPU exposes it
portably.

## Telemetry (FR6)

- `__ROWER3D_SCENERY` — `{ pools: SceneryEntry[], dispatchCount, drawCount }`.
- `__ROWER3D_FOLIAGE` — summarised to match today's `publishFoliage`
  shape (`trees`, `meshes`, `drawn`).
- `__ROWER3D_RENDER_STATS` — `sceneryDispatch`, `sceneryDraws`,
  `sceneryTriangles` added.

## Verification

- Unit:
  - `instancePools.test.ts` — packing, pool creation, buffer dispose.
  - `sceneryCullParity.test.ts` — distance + frustum numerical parity vs
    the ported `compactVisible` reference.
  - `sceneryPass.test.ts` — one dispatch + one indirect draw per pool;
    telemetry per pool; empty-pools no-op; dispose idempotent.
  - `telemetry.test.ts` — snapshot keeps the main-branch shape and adds
    the new `__ROWER3D_SCENERY` / `__ROWER3D_FOLIAGE` entries.
  - `wgsl.test.ts` — `sceneryCull.wgsl` and `scenery.wgsl` parse via
    `wgsl_reflect` and declare their entry points.
- Playwright: `playwright/tests/webgpu-scenery-smoke.spec.ts` under
  `/smoke/scenery`.

## Frame-time measurements

> _Pending the GPU runner (D5-b of #542). SwiftShader's WebGPU support is
> intermittent on `ubuntu-latest`, so the `webgpu-engine` CI job stays
> `continue-on-error` until the runner is wired in. Fill in once numbers
> are available._

| Tier | Route (40 km) | CPU/frame on scenery | GPU dispatch cost | drawIndirect cost |
|------|---------------|----------------------|-------------------|-------------------|
| basic       | — | — | — | — |
| low         | — | — | — | — |
| medium      | — | — | — | — |
| high        | — | — | — | — |
| extra-high  | — | — | — | — |

The CPU-free scenery pass target from #542 AC6 is **< 0.5 ms/frame** — the
engine does one buffer write and one encoder call per pool and never
walks the centre arrays.

## What's deferred

See [#556](https://github.com/MaximumTrainer/virtualrow/issues/556):

- Hi-Z image-space occlusion cull (D2 extension).
- Multi-draw indirect merge (D3 extension).
- WGSL `#include` preprocessor (D5 extension).
- Global `firstInstance` layout (D1 extension).
- Property-based fuzzing on the reference pass (D6 extension).
- Pool streaming by camera progress.
- Pool merging across chunks.
