import { defineConfig } from '@playwright/test';
import ciConfig from './playwright.config.ci';
import { ENDURANCE_SPEC, HEAVY_SPEC, RESPONSIVE_SPEC, VISUAL_SPEC } from './viewports';

// #542 AC2 — Playwright config for the `next/svelte-webgpu` branch's CI.
//
// Extends `playwright.config.ci.ts` and skips specs that cannot pass yet on
// the Svelte + WebGPU branch running under SwiftShader on GitHub's default
// runners:
//
//  * AC4 WebGL-era specs — they target the old three.js renderer. AC4 will
//    port them in place; until then they are red.
//
//  * Engine-dependent specs — the new WebGPU engine declines software
//    adapters (SwiftShader, cloud containers): `attach()` returns null, the
//    ride view shows the "needs WebGPU" screen, and specs that reach into the
//    running engine (boat movement, scene telemetry, foliage draws, oar
//    clearance, scenery kit budgets, …) therefore fail. These pass on a real
//    GPU runner only (D5-b, #548); the `webgpu-engine` and `gpu-smoke` jobs
//    in `next-branch-ci.yml` already cover that real-GPU path.
//
//  * Smokes a dedicated job already runs — kept out of the shard plan so
//    they aren't double-counted and don't rebuild the preview.
//
// Everything else — UI chrome (auth, intervals-login, signed-out test drive),
// pure-data parsers (kml-projection, rownative-*), crash telemetry UI, the
// simulator ports, the "needs WebGPU" screen, loading progress — runs on
// SwiftShader unchanged. That is what this job verifies.
//
// Note on `testIgnore`: it has to be set *per project*. The responsive
// matrix in `viewports.ts` already sets a project-level `testIgnore`, which
// *replaces* any top-level one, so patterns there get silently dropped.
const EXTRA_IGNORE = [
  // AC4 WebGL-era specs AC4 will port to WebGPU in place.
  '**/gl-context-budget.spec.ts',
  '**/webgl-context-recovery.spec.ts',
  '**/rower3d-postfx.spec.ts',
  '**/scene-quality-match.spec.ts',
  // Need a moving boat / live engine frames (real GPU only).
  '**/crew-model-loading.spec.ts',
  '**/default-route-performance.spec.ts',
  '**/oar-clearance.spec.ts',
  '**/quality-tier-endurance.spec.ts',
  '**/route-performance.spec.ts',
  '**/route-performance-budgets.spec.ts',
  '**/rower-slide.spec.ts',
  '**/rower-stroke.spec.ts',
  '**/scene-context-endurance.spec.ts',
  '**/scene-contrast.spec.ts',
  '**/scene-telemetry.spec.ts',
  '**/scenery-kit-budgets.spec.ts',
  '**/shipping-scene.spec.ts',
  '**/shipping-scene-contrast.spec.ts',
  '**/virtualrow.spec.ts',
  '**/world-scale.spec.ts',
  // The main-screen route-import render step mounts the engine too.
  '**/route-import-render.spec.ts',
  // The following all call `expectSceneAlive` or finish a full workout, so the
  // engine must be running. They pass on the GPU runner only.
  '**/signed-out-test-drive.spec.ts',
  '**/activity-upload.spec.ts',
  '**/lake-offline.spec.ts',
  '**/pm5-power.spec.ts',
  '**/route-loading-progress.spec.ts',
  // Takes a signed-in athlete into the ride view — engine mounts, declines.
  '**/load-todays-workout.spec.ts',
  // These call `expectSceneAlive`, which gates on three.js's
  // __ROWER3D_GPU_BACKEND (never set in the WebGPU engine); AC4 picks these
  // up when it ports the scene-health probe to the new engine.
  '**/kml-projection.spec.ts',
  '**/rownative-course-import.spec.ts',
  '**/rownative-track-geometry.spec.ts',
  // Responsive matrix also drives the workout scene — stays off until the
  // engine runs on SwiftShader or we re-point its scene-alive check.
  // (The viewport projects only match `responsive.spec.ts`; keep them off
  // too via the project override below.)
  // The `webgpu-engine` job in next-branch-ci.yml runs these.
  '**/webgpu-engine-smoke.spec.ts',
  '**/webgpu-boat-smoke.spec.ts',
  '**/webgpu-buildings-smoke.spec.ts',
  '**/webgpu-flora-smoke.spec.ts',
  '**/webgpu-postfx-smoke.spec.ts',
  '**/webgpu-scenery-smoke.spec.ts',
  '**/webgpu-shadows-smoke.spec.ts',
  // The `smoke` job in next-branch-ci.yml runs this one.
  '**/svelte-scaffold-smoke.spec.ts',
];

// Compose the usual responsive matrix's `default`-project ignore list with
// EXTRA_IGNORE. The viewport projects (phone-portrait, …) only match the
// one responsive spec, so leave them as-is.
const DEFAULT_IGNORE = [RESPONSIVE_SPEC, ENDURANCE_SPEC, HEAVY_SPEC, VISUAL_SPEC, ...EXTRA_IGNORE];

// Responsive specs mount the workout scene via `expectSceneAlive`, so they're
// off this job too. Drop the per-viewport projects — the shards job runs the
// `default` project only.
export default defineConfig({
  ...ciConfig,
  projects: [{ name: 'default', testIgnore: DEFAULT_IGNORE }],
});
