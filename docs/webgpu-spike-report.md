# #498 WebGPU compute-cull spike — report

Status: **in flight** (Phase 1 scaffold landed; the wire-in, CI job and
Playwright spec are Phase 2; findings get filled in on Phase 3 close).

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

## Phase 1 — scaffold (this PR)

- `src/webgpu/` module with:
  - `types.ts` — `WebGPUCullPort` interface + health shape. The only file
    that imports `@webgpu/types` (ESLint allow-list enforces AC5).
  - `useWebGPUDevice.ts` — request adapter + device, re-request on
    `deviceLost`, fall back on unsupported / software / request failure.
  - `isSoftwareAdapter.ts` — the D5-c check (SwiftShader, llvmpipe,
    Microsoft Basic Render, and the `isFallbackAdapter` flag).
  - `health.ts` — `window.__VIRTUALROW_WEBGPU_HEALTH` writer.
  - `featureFlag.ts` — D6-c runtime + build-time gate.
  - `shaders/foliageCull.wgsl` — the `@workgroup_size(64)` compute kernel.
- Globals in `src/types/index.ts`.
- ESLint rule blocking `@webgpu/types` outside `src/webgpu/`.

Nothing is wired to the scene yet; the module stays out of the default
bundle because the import happens behind the flag in Phase 2.

## Phase 2 — wire + CI + spec (next PR)

- `WebGPUFoliageCuller` component inside `BankFoliage`, lazy-imported when
  `isWebGPUCullEnabled()` is true. Owns the GPU buffers and runs the
  compute dispatch on the existing `FOLIAGE_CULL_FRAME_INTERVAL` cadence.
- Automatic fallback to the CPU `cullTo` on fallback reasons OR a thrown
  dispatch.
- `.github/workflows/webgpu-spike.yml` — Chromium with
  `--enable-unsafe-webgpu` on Linux + Windows, running the spike spec only.
- Playwright spec covering AC1 (parity), AC3 (unsupported), AC4
  (device-lost synthesised through a Playwright hook).

## Phase 3 — findings and close

Filled in with:
- AC2 timings: cull wall-time (dispatch + mapped read) vs. today's CPU
  `cullTo`, measured on the demo route and a 40 km synthetic one.
- Caveats about SwiftShader CI numbers (D5-c excludes them, but the real
  cost is reported).
- Whether the next-track spike (second canvas, dual-renderer root, CSM in
  WGSL) is worth starting.
