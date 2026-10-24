# P2 — WebGPU engine core

Issue: [#550](https://github.com/MaximumTrainer/virtualrow/issues/550). Phase 2 of the
epic [#542](https://github.com/MaximumTrainer/virtualrow/issues/542).

This phase stands up the hand-written WebGPU engine behind the UI shell's
canvas seam. P3+ (GPU-driven scenery, CSM, flora LOD, buildings, crew,
post-processing) layer onto this skeleton.

## What landed

- **Math layer** (`src/lib/renderer/math/`, D1-c): hand-rolled
  `vec3` / `mat4` / `quat` / `curve` (three-free port of
  `src/components/rower3d/curve.ts`) / `frustum`. No `three` import under
  `src/lib/renderer/`; the ESLint rule in `eslint.config.js` enforces it.
- **Device layer** (`src/lib/renderer/engine/device.ts`): request adapter +
  device; reject software adapters (SwiftShader / llvmpipe / Microsoft Basic
  Render / `isFallbackAdapter`); one `deviceLost` re-request; second loss or
  no WebGPU surfaces `renderer-unavailable` on the telemetry callback.
- **Frame graph** (`src/lib/renderer/engine/frameGraph.ts`, D2-b): an ordered
  `Pass[]` with a `FrameContext` (device, encoder, swap view, depth view,
  frame uniforms). Exactly one swapchain submit per frame; pass order is
  `sky → bank → water` (device spy in `frameGraph.test.ts` asserts both).
- **Camera rig** (`src/lib/renderer/engine/camera.ts`): three-free port of
  `cameraRig.ts`'s look-ahead / offset / damping. Same four views
  (`chase`, `side`, `bow`, `high`), same taus, same portrait-FOV formula.
- **Three passes**: `sky`, `bank`, `water` under `src/lib/renderer/passes/`
  with WGSL files beside their TS. Plan modules in
  `src/lib/renderer/plan/` port the minimum geometry needed to draw.
  Full geometry parity with the three scene is a later phase.
- **Engine entry** (`src/lib/renderer/engine/attach.ts`, D4-b): exports
  `attach: RideAttach` matching the UI thread's `RideAttach` / `RideRenderer`
  signature from `src/lib/ui/rideCanvas.ts` (on their branch). Returning
  `null` means "unavailable" and the shell shows its placeholder.
- **Telemetry** (`src/lib/renderer/engine/telemetry.ts`): engine writes
  `__ROWER3D_*` globals directly (no sink), keeping the same shapes
  `main`'s three scene publishes. `__VIRTUALROW_WEBGPU_HEALTH` keeps the
  shape ported from `src/webgpu/health.ts`.
- **Playwright smoke**: `playwright/tests/webgpu-engine-smoke.spec.ts`
  against the hidden `/__smoke__/engine/` route.
- **CI job**: `webgpu-engine` added to `.github/workflows/next-branch-ci.yml`,
  gated on `vars.GPU_RUNNER_LABEL`, `continue-on-error: true` until a real
  GPU runner lands (D5-b of #542 / D8-b of #550).
- **ESLint**: `@webgpu/types` moved from `src/webgpu/` to
  `src/lib/renderer/`; `three` forbidden under `src/lib/renderer/`.
- **Retired** (D7-c): `src/webgpu/` deleted on this branch, along with its
  Playwright spec; the three-scene foliage component is patched to a `false`
  stub for `isWebGPUCullEnabled` (the whole React scene retires with P1).

## Deferred to later phases

- GPU compute cull + indirect draws → **P3**.
- CSM + flora depth pass → **P4**.
- Flora LOD + KTX2 texture pipeline → **P5**.
- Procedural buildings + furniture + full sky/cloud model → **P6**.
- Boat, ghost, hand-written crew skinning → **P7**.
- Post-processing (bloom, tone, vignette, grade) → **P8**.
- Unsupported-browser screen + debug overlay → **P9**.

## Measurements (fill in from the GPU runner)

| Scenario                                            | Metric                     | Value |
| --------------------------------------------------- | -------------------------- | ----- |
| Attach → first frame, idle route, ref laptop        | ms                         | TBD   |
| Attach → first frame, ref laptop + SwiftShader      | ms                         | TBD   |
| Engine chunk size (gzip-less, built on this branch) | KB (NFR floor is ≤ 120 KB) | TBD   |

Fill these in on the first green run of the `webgpu-engine` CI job on the
GPU runner, and link the run.
