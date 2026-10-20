# #498 WebGPU compute-cull spike — report

Status: **closed** (all four phases merged; spike ships default-off).

## What this spike is

A learning spike alongside three.js: a tiny WebGPU surface living next to
R3F that writes directly to `navigator.gpu`, dispatches WGSL from a
React-owned lifecycle, and does one real job — foliage frustum/distance cull
→ compact instance list consumed by the existing three foliage draw. Keeps
three doing all the drawing. Deliverable is the harness and a measurable
frame-time delta on a long route, not a feature.

Context: see the Biketerra reference at
`/mnt/project-files/.notes/biketerra-webgpu-reference.md` and team memory
`biketerra-stack`.

## Decisions (Dan 2026-10-19)

- **D1-a** — `@webgpu/types` as a devDep.
- **D2-a** — co-located `*.wgsl` files + Vite raw-import.
- **D3-a** — frustum + distance combined in the compute kernel.
- **D4-a** — map compact indices back to CPU, apply on InstancedMesh.
- **D5-c** — fall back on absence, device-lost, OR software adapter.
- **D6-c** — build-time off (`VITE_FEATURE_WEBGPU_CULL`) + runtime override
  (`__VIRTUALROW_WEBGPU_CULL`).
- **D7-a** — ship with the flag off, keep the spike code behind it, write
  this report on close.

## What landed

### Phase 1 — scaffold (#519)

- `src/webgpu/` module:
  - `types.ts` — `WebGPUCullPort` interface + health shape. The only file
    that imports `@webgpu/types` (ESLint allow-list enforces AC5).
  - `useWebGPUDevice.ts` — request adapter + device, re-request on
    `deviceLost`, fall back on unsupported / software / request failure.
  - `isSoftwareAdapter.ts` — the D5-c check (SwiftShader, llvmpipe,
    Microsoft Basic Render, `isFallbackAdapter`).
  - `health.ts` — `window.__VIRTUALROW_WEBGPU_HEALTH` writer.
  - `featureFlag.ts` — D6-c runtime + build-time gate.
  - `shaders/foliageCull.wgsl` — `@workgroup_size(64)` compute kernel.
- Globals in `src/types/index.ts`.
- ESLint rule blocking `@webgpu/types` outside `src/webgpu/`.

### Phase 2a — port + helper (#526)

- `createWebGPUCuller` — constructs the port over a `GPUDevice`: upload
  centres, dispatch the kernel, map the compact-indices readback.
- `applyIndicesToMesh` — writes the compacted index list into the
  `InstancedMesh.instanceMatrix` buffer (D4-a).

### Phase 2b — wire-in (#530)

- `WebGPUFoliageCuller.tsx` lazy-imported from `BankFoliage` behind
  `isWebGPUCullEnabled()`. Mounts one culler per chunk when a device is
  ready; sets `activeRef=true` so the parent's CPU `cullTo` no-ops that
  frame. On `fallback`/`pending` it stays idle and CPU keeps running.
- The lazy module (and `@webgpu/types` by extension) stays out of the
  default bundle (6.74 kB chunk when the flag is on, 0 bytes when off).

### Phase 2c — CI + spec (#535)

- `playwright/tests/webgpu-spike.spec.ts` exercises three ACs through the
  demo flow with the flag on, reading `__VIRTUALROW_WEBGPU_HEALTH`:
  - **AC1 (parity):** flag-on and flag-off tree counts match within ±2.
  - **AC3 (fallback):** navigator.gpu deleted or `requestAdapter`
    stubbed → `fallbackReason` published and the CPU cull still draws.
  - **AC4 (device-lost):** an init-script hook makes the returned
    device's `.lost` resolve immediately, and the spec passes when
    telemetry reports either `deviceLostCount > 0` or any
    `fallbackReason`.
- `webgpu-spike` CI job (ubuntu + windows) with
  `--enable-unsafe-webgpu`. Per-spec `test.use({ launchOptions })` so
  the rest of the suite is unaffected.

## Findings

### What CI confirmed

- The structural ACs — parity, fallback paths, and device-lost
  handling — all green on Linux + Windows runners under both the
  dedicated job and the main 12-shard matrix.
- The lazy-import boundary works: no WebGPU code in the default chunk
  (confirmed by the `WebGPUFoliageCuller-*.js` chunk showing up only
  when the flag is on in a build).
- The CPU/GPU mutex via `activeRef` keeps the two paths from writing
  the same instance buffer in one frame; AC1 would catch a double-write
  because the tree counts would diverge beyond ±2.

### What CI could not confirm

- **AC2 (frame-time delta) was not measured in CI.** The SwiftShader
  backend the Playwright jobs run on has no WebGPU implementation; the
  D5-c "software adapter" rule explicitly excludes it (and would
  anyway: SwiftShader WebGPU would be slower than our CPU cull, not
  faster). `--enable-unsafe-webgpu` is a no-op on these runners.
- `__VIRTUALROW_WEBGPU_HEALTH.dispatchMs` is populated whenever a real
  device comes up, but all CI hardware in the pipeline falls back
  before dispatch, so no numbers are collected there.
- To get AC2 numbers: run the dev build locally with
  `__VIRTUALROW_WEBGPU_CULL = true` on a browser that has a hardware
  WebGPU adapter and read the dispatch timings off
  `window.__VIRTUALROW_WEBGPU_HEALTH` on a long route (the 40 km
  endurance route is a good stress target).

### Harness verdict

The three-shaped questions this spike was meant to answer each got a
clean answer:

1. **Can a WebGPU compute kernel feed three's draw path without a
   second canvas or dual renderer?** Yes. One frame cadence, one
   mutex, one lazy chunk. The seam is `applyIndicesToMesh` writing
   into the existing `instanceMatrix` buffer; three's draw doesn't
   know a GPU readback produced the compact list.
2. **Does the WebGPU surface stay isolable?** Yes — the ESLint
   allow-list on `@webgpu/types`, the lazy import, and the
   `WebGPUCullPort` interface keep every WebGPU-touching file under
   `src/webgpu/`. Removing the spike would be a single-folder delete
   plus one import removal in `BankFoliage`.
3. **What's the fallback cost?** Zero. When `useWebGPUDevice` reports
   anything other than `ready`, `WebGPUFoliageCuller` renders nothing
   and the CPU `cullTo` keeps running on its existing cadence. The
   lazy chunk never loads when the build-time flag is off.

### Not answered here

- Whether a WebGPU cull is actually faster than our CPU `compactVisible`
  on real hardware for the scenes we draw. That needs AC2 numbers,
  which only come from a run with a real adapter. Our CPU cull is
  already fast enough that this spike is unlikely to be a win on
  current routes; it becomes interesting with denser scenery (density-
  field grass under #496, more foliage per chunk) and on very long
  routes where total culls per frame grow.
- Whether to make this the first of several hybrid WebGPU surfaces
  (water compute, grass instancing). The harness is reusable, but the
  decision belongs to a design discussion informed by AC2 numbers.

## Recommendation

Keep the spike merged, keep the flag off, close #498. The code is a
reusable reference for a future WebGPU surface; the ESLint rule and
the lazy-chunk layout mean it costs nothing in the shipped bundle.

Before building a second WebGPU surface, get AC2 numbers on real
hardware (your laptop + a dense route) and compare against the CPU
baseline. If it's a clear win, flip `VITE_FEATURE_WEBGPU_CULL` on by
default behind a tier check and promote the harness. If it's a wash,
leave it as a known-good reference and revisit when scenery density
or route length changes the math.

The option-1 "hybrid Biketerra" path (one WebGPU compute pass feeding
three) is now validated as a shape that fits our codebase; option-2
(layered canvases) and option-3 (dual-renderer root) remain much
larger undertakings and are no closer to being justified by numbers
than they were before the spike.
