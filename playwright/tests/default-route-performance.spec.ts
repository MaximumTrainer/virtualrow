import { test, expect, type Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { useSimServer, releaseSimServer, emitPm5 } from '../utils/sim-server';
import { expectSceneAlive } from '../utils/scene-health';

/**
 * Issue #255 — the default route renders and runs correctly at low, auto and
 * high, across the range of rower speeds, without lag.
 *
 * This is a real in-browser measurement: the scene is driven at each quality
 * tier while PM5 frames are fed at four paces, and the app's own frame
 * telemetry is read back per speed phase.
 *
 * Two things govern how it is written.
 *
 * Sessions are a shared resource. Adding two extra demo rows to one spec
 * earlier in this work left the macOS runner unable to draw for the specs
 * behind it — route-performance and two scene-quality-match tiers failed with
 * zero frames, having passed in the run where that spec bailed early. So this
 * sweeps every speed *inside* one session per tier: three sessions in total,
 * the same count quality-tier-endurance.spec.ts already uses, rather than one
 * session per tier-and-speed pair.
 *
 * And a frame rate measured here is not the engine's. CI draws through
 * SwiftShader, where a heavy route renders a couple of frames a minute, so an
 * fps budget asserted unconditionally would be asserting the rasteriser. The
 * budget is enforced on hardware that can be judged by it and the measurement
 * is logged either way, which is the line route-performance-budgets.spec.ts
 * already draws. Asserted everywhere is the part that is honest everywhere:
 * the scene keeps producing frames at every speed, the boat keeps advancing,
 * the context survives, and nothing throws.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mockBluetoothPath = path.resolve(__dirname, '../mock-bluetooth.js');

/**
 * Whether the simulator is up. Without it no PM5 frames arrive, and the scene
 * draws exactly one frame and then idles — sampledAt frozen, progress zero —
 * which is indistinguishable from a renderer that has died.
 */
let simulatorReady = false;

test.beforeAll(async () => {
  simulatorReady = await useSimServer();
});

test.afterAll(async () => {
  await releaseSimServer();
});

/** Pace is seconds per 500 m, so a smaller number is a faster rower. */
interface SpeedPhase {
  label: string;
  paceSecondsPer500m: number;
  cadence: number;
}

const SPEED_PHASES: SpeedPhase[] = [
  { label: 'paddle', paceSecondsPer500m: 150, cadence: 18 },
  { label: 'steady', paceSecondsPer500m: 120, cadence: 24 },
  { label: 'race', paceSecondsPer500m: 95, cadence: 32 },
  { label: 'sprint', paceSecondsPer500m: 80, cadence: 38 },
];

/** Rowing per phase: long enough to gather frames, short enough to afford. */
const PHASE_SECONDS = 5;

/**
 * How often PM5 frames are delivered, which depends on who is drawing.
 *
 * Every tick is a round trip into the page, and a round trip queues behind the
 * frame in progress. On a software rasteriser at the high tier a frame costs
 * seconds, so 10 Hz for four phases - 200 trips - ran past the 480s budget and
 * timed out. It used to fit only because the scene lost its WebGL context a few
 * seconds in and stopped drawing altogether; with the context surviving, the
 * renderer is busy for the whole sweep and the cost is real.
 *
 * Dropping the rate there costs nothing that is measured: pacing is recorded
 * rather than enforced on a software rasteriser, and distance and elapsed time
 * are both derived from the rate, so they stay coherent at any of them.
 */
const EMIT_HZ_HARDWARE = 10;
const EMIT_HZ_SOFTWARE = 2;

/** Per-frame budget from #224, in milliseconds at the 95th percentile. */
const P95_BUDGET_MS = 18;

interface FrameSample {
  frames: number;
  fps: number;
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
}

async function bootAt(page: Page, mode: 'low' | 'auto' | 'high') {
  await page.addInitScript({ content: fs.readFileSync(mockBluetoothPath, 'utf8') });
  await page.addInitScript((m) => {
    (window as unknown as { __VIRTUALROW_PERFORMANCE_MODE?: string })
      .__VIRTUALROW_PERFORMANCE_MODE = m;
  }, mode);
}

async function waitForDeviceConnected(page: Page, deviceLabel: string) {
  await page.waitForFunction(
    (label) => {
      const containers = Array.from(document.querySelectorAll('.bluetooth-device-container'));
      const target = containers.find((c) =>
        c.querySelector('.device-name')?.textContent?.includes(label),
      );
      return target?.querySelector('.device-status')?.textContent?.includes('Connected') ?? false;
    },
    deviceLabel,
    { timeout: 10_000 },
  );
}

/** Copied from route-performance-budgets.spec.ts, which is where it works. */
async function connectHardwareAndStart(page: Page) {
  await page.getByRole('button', { name: 'Connect PM5', exact: true }).click();
  await waitForDeviceConnected(page, 'Concept2 PM5');
  await page.evaluate(() => {
    const containers = Array.from(document.querySelectorAll('.bluetooth-device-container'));
    const hr = containers.find((c) =>
      c.querySelector('.device-name')?.textContent?.includes('Heart Rate Monitor'),
    );
    (hr?.querySelector('button.btn-connect') as HTMLButtonElement)?.click();
  });
  await waitForDeviceConnected(page, 'Heart Rate Monitor');

  await expect(page.locator('.btn-start-workout')).toBeEnabled({ timeout: 10_000 });
  await page.evaluate(() => {
    (document.querySelector('.btn-start-workout') as HTMLButtonElement)?.click();
  });
  await expect(page.locator('.rower3d-canvas-container')).toBeVisible({ timeout: 30_000 });
  await expectSceneAlive(page, 'the default route scene');
}

/**
 * True when the page is drawing through a software rasteriser.
 *
 * Same question route-performance-budgets.spec.ts asks, deciding the same
 * thing: whether a frame-time number describes the engine or the rasteriser.
 */
async function isSoftwareRenderer(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '';
    return /swiftshader|llvmpipe|software|angle \(google/i.test(name);
  });
}

async function readFrameStats(page: Page): Promise<FrameSample | null> {
  return page.evaluate(() => {
    const s = window.__ROWER3D_FRAME_STATS;
    return s
      ? { frames: s.frames, fps: s.fps, p50Ms: s.p50Ms, p95Ms: s.p95Ms, maxMs: s.maxMs }
      : null;
  });
}

/**
 * Time a run of frames the test asks for directly.
 *
 * The render loop idles between frames here, so waiting for it measures the
 * wait rather than the work. Driving the renderer through the same hook the
 * docs capture uses (#261) gives the per-frame cost itself: the scene is asked
 * to draw, and the drawing is timed. That is a real measurement on any
 * renderer, software included — it describes how long this scene takes to
 * draw, which is the question #255 asks.
 */
async function measureFrameCostMs(page: Page, frames = 5): Promise<number | null> {
  return page.evaluate(async (count) => {
    const force = window.__ROWER3D_FORCE_RENDER;
    if (!force) return null;
    const samples: number[] = [];
    for (let i = 0; i < count; i += 1) {
      const started = performance.now();
      force();
      samples.push(performance.now() - started);
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    }
    samples.sort((a, b) => a - b);
    return samples[Math.floor(samples.length / 2)];
  }, frames);
}

/** When the renderer last recorded a frame; advances only if the loop is alive. */
async function readSampledAt(page: Page): Promise<number> {
  return page.evaluate(() => window.__ROWER3D_RENDER_STATS?.sampledAt ?? 0);
}

async function readProgress(page: Page): Promise<number> {
  return page.evaluate(() => window.__ROWER3D_POS?.progress ?? 0);
}

interface PhaseResult {
  distance: number;
  seconds: number;
  /** Whether the render loop advanced during the phase. */
  drew: boolean;
  delivered: boolean;
  /** Median cost of a frame the test asked for, in ms. */
  frameCostMs: number | null;
}

/**
 * Row one speed phase, returning what the scene did during it.
 *
 * Distance and elapsed time advance consistently with the pace being asked
 * for, so the app sees a rower genuinely going that fast rather than a pace
 * field that disagrees with the distance it is paired with.
 */
async function rowPhase(
  page: Page,
  phase: SpeedPhase,
  startDistance: number,
  startSeconds: number,
  emitHz: number,
): Promise<PhaseResult> {
  const metresPerSecond = 500 / phase.paceSecondsPer500m;
  // Liveness comes from the render-stats timestamp, not from the frame count:
  // FrameStatsRecorder.frames is the number of samples in a rolling window, so
  // it plateaus once the window is full and a delta of zero means the window is
  // saturated, not that the scene stopped.
  const before = await readSampledAt(page);
  const ticks = PHASE_SECONDS * emitHz;
  let distance = startDistance;
  let seconds = startSeconds;
  let delivered = true;

  for (let i = 0; i < ticks; i += 1) {
    seconds += 1 / emitHz;
    distance += metresPerSecond / emitHz;
    const ok = await emitPm5({
      distance: Math.round(distance),
      // Seconds. The mock converts to the wire's centiseconds itself; sending
      // milliseconds told the app the row had run a hundred times longer than
      // it had (#296).
      elapsedTime: Math.round(seconds),
      pace: phase.paceSecondsPer500m,
      cadence: phase.cadence,
      power: Math.round(2.8 * metresPerSecond ** 3),
      heartRate: 120 + Math.round(metresPerSecond * 8),
    });
    if (!ok) delivered = false;
    await page.waitForTimeout(1000 / emitHz);
  }

  const after = await readSampledAt(page);
  const frameCostMs = await measureFrameCostMs(page);
  return { distance, seconds, drew: after > before, delivered, frameCostMs };
}

for (const tier of ['low', 'auto', 'high'] as const) {
  test(`the default route holds up at ${tier} across rower speeds (#255)`, async ({ page }) => {
    test.slow();

    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

    expect(
      simulatorReady,
      'the PM5 simulator is not reachable, so no rowing data can be delivered',
    ).toBe(true);

    await bootAt(page, tier);
    await page.goto('./');

    // The default route, unchanged: this spec is about the route a first-time
    // visitor actually gets, not a generated fixture.
    await expect(page.locator('.route-info-overlay h2')).toContainText('Willowbrook River');

    await connectHardwareAndStart(page);
    const software = await isSoftwareRenderer(page);
    const emitHz = software ? EMIT_HZ_SOFTWARE : EMIT_HZ_HARDWARE;

    // A budget that matches what the work now costs.
    //
    // The scene keeps its WebGL context for the whole sweep, so a software
    // rasteriser draws every frame of it rather than dying a few seconds in and
    // going quiet. At the high tier that is around 0.7 fps, and the sweep takes
    // minutes rather than seconds. Measured locally on SwiftShader after the
    // emit rate was paced to the renderer: low 57s, auto 1.8m, high 3.7m.
    //
    // The budget has to fit inside the job step that contains it. Three tiers
    // at fifteen minutes each came to 45 minutes of possible budget inside a
    // 40 minute step - and a test that exhausts its own budget at least says
    // so, where one that exhausts the step's takes every result after it down
    // with it (#300). Ten minutes a tier leaves the three of them inside the
    // step with room for the rest of the suite.
    if (software) test.setTimeout(600_000);

    // Let the scene settle before measuring, so mount cost is not charged to
    // the first phase.
    await page.waitForTimeout(3_000);

    const report: string[] = [];
    const costByPhase: Array<[string, number | null]> = [];
    const progressByPhase: number[] = [await readProgress(page)];
    let distance = 0;
    let seconds = 0;
    let anyDelivered = false;

    for (const phase of SPEED_PHASES) {
      const result = await rowPhase(page, phase, distance, seconds, emitHz);
      distance = result.distance;
      seconds = result.seconds;
      anyDelivered = anyDelivered || result.delivered;

      const stats = await readFrameStats(page);
      progressByPhase.push(await readProgress(page));
      costByPhase.push([phase.label, result.frameCostMs]);
      report.push(
        `${tier}/${phase.label} (${phase.paceSecondsPer500m}s/500m): ` +
          `frameCost=${result.frameCostMs?.toFixed(1) ?? 'n/a'}ms ` +
          `drew=${result.drew} windowFrames=${stats?.frames ?? 'n/a'} ` +
          `fps=${stats?.fps.toFixed(1) ?? 'n/a'} ` +
          `p50=${stats?.p50Ms.toFixed(1) ?? 'n/a'}ms p95=${stats?.p95Ms.toFixed(1) ?? 'n/a'}ms ` +
          `max=${stats?.maxMs.toFixed(1) ?? 'n/a'}ms software=${software}`,
      );

      // True at every speed and on every renderer: the scene produced
      // telemetry and it is sane. Pacing is judged below, where it can be.
      expect(stats, `${tier}/${phase.label}: no frame telemetry`).toBeTruthy();
      expect(
        stats!.frames,
        `${tier}/${phase.label}: no frames in the measurement window`,
      ).toBeGreaterThan(0);
      expect(Number.isFinite(stats!.p95Ms), `${tier}/${phase.label}: p95 not finite`).toBe(true);
      expect(Number.isFinite(stats!.fps), `${tier}/${phase.label}: fps not finite`).toBe(true);

      if (!software) {
        // On hardware that renders in milliseconds rather than seconds, the
        // loop must keep running at every speed and stay inside the budget.
        //
        // Skipped on a software rasteriser for the reason quality-tier-
        // endurance.spec.ts and the #224 budget spec already skip it, and which
        // was measured directly while writing this: on SwiftShader the default
        // route draws one frame at about 0.77 fps and then idles, so `drew`
        // over a five-second phase is false for a scene that is working
        // perfectly, and any pacing number would describe the rasteriser.
        expect(result.drew, `${tier}/${phase.label}: the render loop stopped`).toBe(true);
        expect(
          stats!.p95Ms,
          `${tier}/${phase.label}: p95 frame time over budget`,
        ).toBeLessThanOrEqual(P95_BUDGET_MS);
      }
    }

    console.log(report.join('\n'));

    // The rower moved, and never backwards. Progress advances inside the frame
    // loop, so this is answerable only where the loop actually runs.
    if (software) {
      console.log(
        `${tier}: software rasteriser — frame pacing and travel are not measurable here; ` +
          'the measurements above are recorded, not enforced',
      );
    } else if (anyDelivered) {
      const total = progressByPhase[progressByPhase.length - 1] - progressByPhase[0];
      expect(total, `${tier}: the boat never advanced`).toBeGreaterThan(0);
      for (let i = 1; i < progressByPhase.length; i += 1) {
        expect(Number.isFinite(progressByPhase[i]), `${tier}: progress went non-finite`).toBe(true);
        expect(
          progressByPhase[i],
          `${tier}: progress went backwards at phase ${i}`,
        ).toBeGreaterThanOrEqual(progressByPhase[i - 1]);
      }
    } else {
      console.log(`${tier}: simulator unreachable, speed sweep not delivered`);
    }

    // The cost of a frame must not grow with how hard the rower is pulling.
    // Speed changes where the boat is on the route, not how much scene there
    // is to draw, so a sprint costing materially more than a paddle means
    // something scales with progress that should not (#255).
    //
    // Measured on whatever renderer is present, because the frames are asked
    // for rather than waited on — this is the scene's own drawing cost, not
    // the rasteriser's frame rate.
    const costs = costByPhase.filter((c): c is [string, number] => typeof c[1] === 'number');
    if (costs.length === SPEED_PHASES.length) {
      const cheapest = Math.min(...costs.map(([, ms]) => ms));
      const dearest = Math.max(...costs.map(([, ms]) => ms));
      console.log(
        `${tier}: frame cost ${costs.map(([l, ms]) => `${l}=${ms.toFixed(1)}ms`).join(' ')}`,
      );

      // A generous multiple: this is meant to catch cost that scales with
      // speed, not to pin down a number that varies with the machine.
      expect(
        dearest,
        `${tier}: a frame costs ${dearest.toFixed(1)}ms at speed against ` +
          `${cheapest.toFixed(1)}ms at a paddle — per-frame work is scaling with rower speed`,
      ).toBeLessThanOrEqual(Math.max(cheapest * 3, cheapest + 40));
    }

    // The context survived the whole sweep, and nothing threw.
    const context = await page.evaluate(() => window.__ROWER3D_CONTEXT_STATE ?? null);
    expect(context?.losses ?? 0, `${tier}: the WebGL context was lost`).toBe(0);
    expect(errors, `${tier}: the scene raised errors`).toEqual([]);
  });
}

/**
 * The ends of the range, which the four ordinary phases do not reach: a rower
 * who has stopped, and one going faster than anybody can (#255).
 *
 * One session, at the cheapest tier, because this is about arithmetic
 * surviving extreme inputs rather than about how the scene looks.
 *
 * What this does and does not prove. Progress advances inside useFrame, and
 * the render loop idles between frames here (#261) — asking the renderer to
 * draw does not run the frame callbacks — so progress stays at 0 throughout
 * and the travel half of the question is not answered here. It is covered in
 * the sweep above, where the loop runs. What *is* answered, and is the part
 * that breaks messily when it breaks: a pace of zero and a pace nobody can row
 * leave progress, the boat and the camera finite, in range, and never going
 * backwards. A divide-by-zero or a NaN camera would fail this.
 */
test('progress and the camera survive a stall and an absurd speed (#255)', async ({ page }) => {
  test.slow();
  expect(simulatorReady, 'the PM5 simulator is not reachable').toBe(true);

  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await bootAt(page, 'low');
  await page.goto('./');
  await connectHardwareAndStart(page);
  await page.waitForTimeout(3_000);

  const readState = () =>
    page.evaluate(() => ({
      progress: window.__ROWER3D_POS?.progress ?? null,
      x: window.__ROWER3D_POS?.x ?? null,
      z: window.__ROWER3D_POS?.z ?? null,
      camera: window.__ROWER3D_CAMERA?.position ?? null,
    }));

  const extremes: Array<{ label: string; pace: number; cadence: number }> = [
    { label: 'stalled', pace: 0, cadence: 0 },
    { label: 'absurd', pace: 20, cadence: 60 },
    { label: 'stalled again', pace: 0, cadence: 0 },
  ];

  const seen: Array<{ label: string; progress: number }> = [];
  let distance = 0;
  let seconds = 0;

  for (const extreme of extremes) {
    const metresPerSecond = extreme.pace > 0 ? 500 / extreme.pace : 0;
    for (let i = 0; i < 20; i += 1) {
      seconds += 0.1;
      distance += metresPerSecond / 10;
      await emitPm5({
        distance: Math.round(distance),
        elapsedTime: Math.round(seconds),
        pace: extreme.pace,
        cadence: extreme.cadence,
        power: 0,
        heartRate: 130,
      });
      await page.waitForTimeout(100);
    }
    // Ask for frames so the state advances, rather than waiting on an idle loop.
    await measureFrameCostMs(page, 3);

    const state = await readState();
    expect(Number.isFinite(state.progress), `${extreme.label}: progress is not finite`).toBe(true);
    expect(Number.isFinite(state.x), `${extreme.label}: boat x is not finite`).toBe(true);
    expect(Number.isFinite(state.z), `${extreme.label}: boat z is not finite`).toBe(true);
    expect(state.progress!, `${extreme.label}: progress left 0..1`).toBeGreaterThanOrEqual(0);
    expect(state.progress!, `${extreme.label}: progress left 0..1`).toBeLessThanOrEqual(1);
    expect(state.camera, `${extreme.label}: no camera`).not.toBeNull();
    expect(
      state.camera!.every((n) => Number.isFinite(n)),
      `${extreme.label}: camera is not finite — ${JSON.stringify(state.camera)}`,
    ).toBe(true);

    seen.push({ label: extreme.label, progress: state.progress! });
  }

  console.log(
    `extremes: ${seen.map((s) => `${s.label}=${s.progress.toFixed(4)}`).join(' ')}` +
      ' (all zero while the loop idles — see #261)',
  );

  // Never backwards, at any speed, including when the rower stops.
  for (let i = 1; i < seen.length; i += 1) {
    expect(
      seen[i].progress,
      `progress went backwards between ${seen[i - 1].label} and ${seen[i].label}`,
    ).toBeGreaterThanOrEqual(seen[i - 1].progress);
  }

  expect(errors, 'the scene raised errors at the extremes').toEqual([]);
});
