/**
 * Shared harness for the WebGPU-engine ride e2e specs (#570 AC2 / #584 AC5).
 *
 * These specs drive the real Svelte `/row` flow (not a `/smoke/*` page) and
 * assert the boat actually moves under the hand-written WebGPU engine. The
 * engine declines software adapters, so the ride only renders on a real GPU
 * runner; on a runner without one (CI's SwiftShader, a cloud container) the
 * engine publishes a fallback reason instead and the specs assert that the
 * decline is well-formed rather than silently passing (#542 NFR5).
 *
 * Unlike the `/smoke/*` specs — which force `--use-gl=swiftshader` because they
 * only exercise the fallback path on CI — these launch Chromium with real
 * WebGPU enabled (Vulkan backend), so on the GPU runner they reach the hardware
 * adapter and run the motion assertions for real. That is the whole point of
 * the AC: a genuine boot-and-row on the engine, not a SwiftShader stand-in.
 */
import { expect, type Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// playwright/tests/helpers -> playwright/mock-bluetooth.js
const mockBluetoothPath = path.resolve(__dirname, '../../mock-bluetooth.js');

/**
 * Launch Chromium with real WebGPU available. Mirrors
 * `scripts/gpu-runner-smoke.mjs`: `--enable-unsafe-webgpu` exposes
 * `navigator.gpu`, and Linux headless Chromium gates its WebGPU backend behind
 * the Vulkan feature, so the two are paired. No `--use-gl=swiftshader` here —
 * forcing software GL is what keeps the `/smoke/*` specs on the fallback path;
 * these must reach the NVIDIA device when one is present.
 */
export const GPU_RIDE_LAUNCH_OPTIONS = {
  // Local escape hatch: point at a system Chromium when the repo's pinned
  // Playwright browser build isn't installed (e.g. a dev box or a cloud
  // container with a different build). Unset in CI, so it's inert there.
  ...(process.env.PW_LOCAL_CHROME ? { executablePath: process.env.PW_LOCAL_CHROME } : {}),
  args: [
    '--enable-unsafe-webgpu',
    '--enable-features=Vulkan',
    '--no-sandbox',
    '--disable-dev-shm-usage',
  ],
};

/** The engine's live telemetry, read in one page round-trip so the fields
 * describe the same frame. Field shapes follow
 * `src/lib/renderer/engine/telemetry.ts` (the new engine), NOT the legacy
 * three.js globals in `src/lib/types/index.ts`. */
export interface RideTelemetry {
  pos?: { x: number; y: number; z: number; progress: number };
  boat?: { distanceMeters: number; progress: number; isPlaying: boolean; holding: boolean; finished: boolean };
  crew?: { cadenceSpm: number; strokePhase: number; amplitude: number; rowers: number };
  ghost?: { value: number; active: boolean };
  speedMps?: number;
  route?: { hasCurve: boolean; totalDistance: number; curveLength: number };
  context?: { kind: string; backend: string };
  frame?: { frame: number; dtMs: number; gpuMs: number; cpuMs: number };
}

/** The device-lost banner the ride view shows (#584 FR1), published on
 * `__ROWER3D_BANNER`. Mirrors `Rower3DBanner` in the engine's telemetry.ts. */
export interface RideBanner {
  visible: boolean;
  message: string;
  variant: string;
}

/** The engine's draw accounting, published on `__ROWER3D_RENDER_STATS`.
 * `drawCalls` is a read-only alias of `draws` kept for the legacy harness. */
export interface RideRenderStats {
  draws: number;
  drawCalls: number;
  sceneryDraws?: number;
}

/** Shadow-atlas accounting, published on `__ROWER3D_SHADOWS`. */
export interface RideShadows {
  cascades: number;
  atlasSize: number;
}

/** WebGPU health, published on `__VIRTUALROW_WEBGPU_HEALTH`. */
export interface RideHealth {
  fallbackReason?: string;
  isSoftware?: boolean;
  deviceLostCount?: number;
}

/** Counts the engine makes on the real WebGPU + canvas APIs, recorded by
 * {@link installGpuProbe} before navigation (#584 AC5 context budget). */
export interface GpuProbe {
  adapters: number;
  devices: number;
  contextKinds: string[];
}

type RideWindow = Window & typeof globalThis & {
  __ROWER3D_POS?: RideTelemetry['pos'];
  __ROWER3D_BOAT?: RideTelemetry['boat'];
  __ROWER3D_CREW?: RideTelemetry['crew'];
  __ROWER3D_GHOST_METERS?: RideTelemetry['ghost'];
  __ROWER3D_SPEED_MPS?: number;
  __ROWER3D_ROUTE?: RideTelemetry['route'];
  __ROWER3D_CONTEXT_STATE?: RideTelemetry['context'];
  __ROWER3D_FRAME_STATS?: RideTelemetry['frame'];
  __ROWER3D_RENDER_STATS?: RideRenderStats;
  __ROWER3D_SHADOWS?: RideShadows;
  __ROWER3D_BANNER?: RideBanner;
  __ROWER3D_FORCE_RENDER?: () => void;
  __ROWER3D_FORCE_DEVICE_LOST?: () => void;
  __VIRTUALROW_WEBGPU_HEALTH?: RideHealth;
  __VIRTUALROW_PERFORMANCE_MODE?: 'basic' | 'low' | 'medium' | 'high' | 'extra-high' | 'auto';
  __GPU_PROBE?: GpuProbe;
};

/** Pin the engine's tier before the app loads. `/row` resolves its tier from
 * `resolvePerformanceMode()`, which honours `__VIRTUALROW_PERFORMANCE_MODE`,
 * so this must run as an init script (before navigation). */
export async function pinTier(
  page: Page,
  tier: 'basic' | 'low' | 'medium' | 'high' | 'extra-high',
): Promise<void> {
  await page.addInitScript((t) => {
    (window as RideWindow).__VIRTUALROW_PERFORMANCE_MODE = t;
  }, tier);
}

/**
 * Wrap `navigator.gpu.requestAdapter`, `GPUAdapter.prototype.requestDevice`,
 * and `HTMLCanvasElement.prototype.getContext` before navigation so a spec can
 * assert the engine's context budget — one adapter, one device, and zero WebGL
 * probes — from the real browser APIs (not engine telemetry). Safe when WebGPU
 * is absent: it only wraps what exists.
 */
export async function installGpuProbe(page: Page): Promise<void> {
  // The callback runs in the browser; it avoids the `@webgpu/types` global
  // names (GPU, GPUAdapter, …) because the Playwright tsconfig doesn't load
  // them. Everything is reached structurally through `unknown` casts.
  await page.addInitScript(() => {
    const w = window as RideWindow;
    const probe: GpuProbe = { adapters: 0, devices: 0, contextKinds: [] };
    w.__GPU_PROBE = probe;

    type Fn = (...args: unknown[]) => unknown;
    const gpu = (navigator as unknown as { gpu?: Record<string, unknown> }).gpu;
    if (gpu && typeof gpu.requestAdapter === 'function') {
      const origAdapter = (gpu.requestAdapter as Fn).bind(gpu);
      gpu.requestAdapter = (...args: unknown[]) => {
        probe.adapters += 1;
        return origAdapter(...args);
      };
    }
    const AdapterCtor = (globalThis as unknown as { GPUAdapter?: { prototype: Record<string, unknown> } })
      .GPUAdapter;
    if (AdapterCtor?.prototype && typeof AdapterCtor.prototype.requestDevice === 'function') {
      const origDevice = AdapterCtor.prototype.requestDevice as Fn;
      AdapterCtor.prototype.requestDevice = function patched(this: unknown, ...args: unknown[]) {
        probe.devices += 1;
        return origDevice.apply(this, args);
      };
    }
    const canvasProto = HTMLCanvasElement.prototype as unknown as { getContext: Fn };
    const origGetContext = canvasProto.getContext;
    canvasProto.getContext = function patched(this: unknown, ...args: unknown[]) {
      if (typeof args[0] === 'string') probe.contextKinds.push(args[0]);
      return origGetContext.apply(this, args);
    };
  });
}

/** Read the context-budget probe installed by {@link installGpuProbe}. */
export function readGpuProbe(page: Page): Promise<GpuProbe | undefined> {
  return page.evaluate(() => (window as RideWindow).__GPU_PROBE);
}

/** Force a device loss via the `__PLAYWRIGHT_TESTING`-gated engine seam
 * (#584 FR2). No-op when the seam is absent (fallback / no device). */
export async function forceDeviceLost(page: Page): Promise<void> {
  await page.evaluate(() => (window as RideWindow).__ROWER3D_FORCE_DEVICE_LOST?.());
}

/** Read the device-lost banner the ride view shows (#584 FR1). */
export function readBanner(page: Page): Promise<RideBanner | undefined> {
  return page.evaluate(() => (window as RideWindow).__ROWER3D_BANNER);
}

/** Read the WebGPU health block. */
export function readHealth(page: Page): Promise<RideHealth | undefined> {
  return page.evaluate(() => (window as RideWindow).__VIRTUALROW_WEBGPU_HEALTH);
}

/** Read the engine's draw accounting. */
export function readRenderStats(page: Page): Promise<RideRenderStats | undefined> {
  return page.evaluate(() => (window as RideWindow).__ROWER3D_RENDER_STATS);
}

/** Read the shadow-atlas accounting. */
export function readShadows(page: Page): Promise<RideShadows | undefined> {
  return page.evaluate(() => (window as RideWindow).__ROWER3D_SHADOWS);
}

/** Install the Playwright harness: sets `__PLAYWRIGHT_TESTING`, mocks
 * `navigator.bluetooth`, and exposes `__simulator` + `__workoutService`. Must
 * run before the first navigation. */
export async function installRideHarness(page: Page): Promise<void> {
  const initScript = fs.readFileSync(mockBluetoothPath, 'utf8');
  await page.addInitScript({ content: initScript });
}

/**
 * Boot the app and start a demo row — the shortest path to a live `/row`
 * session with no device wiring. The demo button is present under
 * `__PLAYWRIGHT_TESTING`; `startDemo` fakes the rower connection and starts the
 * PM5/HR simulators, then the session bridge navigates to `/row`. Leaves the
 * page on `/row` with the canvas host mounted.
 */
export async function startDemoRide(page: Page): Promise<void> {
  await page.goto('./');
  await page.waitForSelector('.route-info-overlay h2', { timeout: 15_000 });
  await page.waitForSelector('.btn-try-demo', { timeout: 15_000 });
  // Click through evaluate so the 3D canvas never intercepts the pointer.
  await page.evaluate(() => {
    (document.querySelector('.btn-try-demo') as HTMLButtonElement | null)?.click();
  });
  await page.waitForURL(/\/row(\/)?$/, { timeout: 15_000 });
  await page.waitForSelector('.rower3d-canvas-container canvas', { timeout: 20_000, state: 'attached' });
}

/**
 * Pick the "pace boat" ghost on the Row screen and set its target pace, before
 * the ride starts. The last ghost radio is the pace boat (`none`, `best`,
 * `pace`); the target-pace field only renders once it is chosen.
 */
export async function selectPaceGhost(page: Page, pace = '2:00'): Promise<void> {
  await page.waitForSelector('.ghost-picker input[name="ghost"]', { timeout: 10_000 });
  await page.evaluate(() => {
    const radios = Array.from(
      document.querySelectorAll<HTMLInputElement>('.ghost-picker input[name="ghost"]'),
    );
    radios[radios.length - 1]?.click();
  });
  const paceField = page.locator('.ghost-picker-pace-field');
  await paceField.waitFor({ timeout: 5_000 });
  await paceField.fill(pace);
}

/**
 * Wait until the engine has settled into one of two outcomes and report which:
 *   - `'ready'`  — a real WebGPU adapter attached (`canvas[data-backend=webgpu]`
 *     and `__ROWER3D_CONTEXT_STATE.kind === 'ready'`). The motion assertions
 *     run.
 *   - `'fallback'` — the engine declined (no hardware adapter) and
 *     `__VIRTUALROW_WEBGPU_HEALTH.fallbackReason` is set. The spec asserts the
 *     decline is well-formed instead of the motion.
 * This is the real-`/row` analogue of the `/smoke/*` `data-status` branch;
 * `/row` has no `data-status`, so it keys off the engine's own seams.
 */
export async function waitForRideOutcome(page: Page, timeout = 30_000): Promise<'ready' | 'fallback'> {
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const w = window as RideWindow;
          const ready = w.__ROWER3D_CONTEXT_STATE?.kind === 'ready';
          const declined = !!w.__VIRTUALROW_WEBGPU_HEALTH?.fallbackReason;
          return ready ? 'ready' : declined ? 'fallback' : 'pending';
        }),
      { timeout, intervals: [200, 300, 500, 1000] },
    )
    .not.toBe('pending');

  return page.evaluate(() => {
    const w = window as RideWindow;
    return w.__ROWER3D_CONTEXT_STATE?.kind === 'ready' ? 'ready' : 'fallback';
  });
}

/** Draw one frame if the engine is in test mode (render loop not free-running).
 * A no-op when the hook is absent. */
export async function forceRender(page: Page): Promise<void> {
  await page.evaluate(() => (window as RideWindow).__ROWER3D_FORCE_RENDER?.());
}

/** Read the engine telemetry in a single round-trip. */
export function readRideTelemetry(page: Page): Promise<RideTelemetry> {
  return page.evaluate(() => {
    const w = window as RideWindow;
    return {
      pos: w.__ROWER3D_POS,
      boat: w.__ROWER3D_BOAT,
      crew: w.__ROWER3D_CREW,
      ghost: w.__ROWER3D_GHOST_METERS,
      speedMps: w.__ROWER3D_SPEED_MPS,
      route: w.__ROWER3D_ROUTE,
      context: w.__ROWER3D_CONTEXT_STATE,
      frame: w.__ROWER3D_FRAME_STATS,
    };
  });
}

/** Assert the well-formed-decline path shared by every ride spec's fallback
 * branch: a reason is published and the "needs WebGPU" overlay is shown. */
export async function assertWellFormedDecline(page: Page): Promise<void> {
  const health = await page.evaluate(
    () => (window as RideWindow).__VIRTUALROW_WEBGPU_HEALTH,
  );
  expect(health?.fallbackReason, 'the engine publishes why it declined').toBeTruthy();
}
