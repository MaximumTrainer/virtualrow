/**
 * Smooths the player boat's distance-along-route between the discrete PM5
 * samples that drive it (activity smoothness, #570 track).
 *
 * The raw `distanceMeters` on a `RideFrame` only changes when a new erg sample
 * lands (~2 Hz), so placing the boat straight from it holds for ~30 render
 * frames and then jumps. The first smoothing pass extrapolated forward at the
 * last sample's speed but **hard-snapped** the shown distance to each new
 * sample, so a boundary where the extrapolation had run ahead of (or behind)
 * the next sample popped the boat forward or backward — a per-sample jitter,
 * and a backward pop looks especially wrong because rowing distance only grows.
 *
 * This eases the shown distance toward a velocity-extrapolated target with a
 * critically-damped step and never lets the boat move backward while the row
 * is live, so sample boundaries are invisible and a dropped/paused erg coasts
 * to a stop (capped extrapolation) instead of snapping. The math is pure and
 * clock-injected so it unit-tests without a GPU; the easing adds ~`tau` of lag
 * (≈0.7 m at a 2:00 split), far below the route scale and below the jump it
 * removes.
 */

export interface DistanceSmootherOpts {
  /** Time constant (s) of the exponential approach to the target. Smaller =
   *  snappier and more faithful to the raw distance; larger = smoother with
   *  more trailing lag. ~0.18 s reads smooth without a visible trail. */
  readonly tauSeconds?: number;
  /** Cap on how far past the last sample the target extrapolates, as a
   *  multiple of the last inter-sample interval, so a paused erg coasts to a
   *  stop rather than sailing off (mirrors the previous 1.5× cap). */
  readonly maxExtrapSampleIntervals?: number;
}

export interface DistanceSmoother {
  /**
   * Advance to `nowMs` for the authoritative `distanceMeters` and return the
   * distance the boat should show. `playing` gates the forward-only motion and
   * velocity extrapolation; when false the shown distance just eases toward the
   * raw value (so countdown / pause / finish transitions stay smooth, and the
   * caller's `placeBoat` still owns the hold-at-0 / pin-at-1 behaviour).
   */
  update(distanceMeters: number, playing: boolean, nowMs: number): number;
  /** The current shown distance, without advancing. */
  readonly value: number;
  /** Snap to a known distance (a new row, or a seek). */
  reset(distanceMeters: number, nowMs: number): void;
}

const DEFAULT_TAU_SECONDS = 0.18;
const DEFAULT_MAX_EXTRAP_SAMPLE_INTERVALS = 1.5;
const MIN_SAMPLE_DT_SECONDS = 1e-3;

const finiteOr = (value: number, fallback: number): number =>
  Number.isFinite(value) ? value : fallback;

export const createDistanceSmoother = (opts: DistanceSmootherOpts = {}): DistanceSmoother => {
  const tau = Math.max(1e-3, opts.tauSeconds ?? DEFAULT_TAU_SECONDS);
  const maxExtrap = Math.max(0, opts.maxExtrapSampleIntervals ?? DEFAULT_MAX_EXTRAP_SAMPLE_INTERVALS);

  // The two most recent distinct authoritative samples and when they arrived.
  let sample = { d: 0, t: 0 };
  let prevSample = { d: 0, t: 0 };
  let shown = 0;
  let lastUpdateMs = 0;
  let started = false;

  const reset = (distanceMeters: number, nowMs: number): void => {
    const d = finiteOr(distanceMeters, 0);
    sample = { d, t: nowMs };
    prevSample = { d, t: nowMs };
    shown = d;
    lastUpdateMs = nowMs;
    started = true;
  };

  const update = (distanceMeters: number, playing: boolean, nowMs: number): number => {
    const raw = finiteOr(distanceMeters, sample.d);
    if (!started) {
      reset(raw, nowMs);
      return shown;
    }

    // A distance that went backward is a new row / seek, not motion — snap.
    if (raw < sample.d - 1e-6) {
      reset(raw, nowMs);
      return shown;
    }

    // Record a new authoritative sample without snapping the shown distance;
    // the easing below absorbs the correction so the boundary is invisible.
    if (raw !== sample.d) {
      prevSample = sample;
      sample = { d: raw, t: nowMs };
    }

    // The target the boat eases toward.
    let target: number;
    if (playing) {
      const dtSample = Math.max(MIN_SAMPLE_DT_SECONDS, (sample.t - prevSample.t) / 1000);
      const sampleSpeed = Math.max(0, (sample.d - prevSample.d) / dtSample);
      const dtSinceSample = Math.max(0, (nowMs - sample.t) / 1000);
      const cappedExtrap = Math.min(dtSinceSample, dtSample * maxExtrap);
      target = sample.d + sampleSpeed * cappedExtrap;
    } else {
      target = raw;
    }

    const dt = Math.max(0, (nowMs - lastUpdateMs) / 1000);
    const alpha = 1 - Math.exp(-dt / tau);
    const prevShown = shown;
    shown += (target - shown) * alpha;
    // Forward-only while the row is live: never let the boat drift backward.
    if (playing) shown = Math.max(shown, prevShown);
    lastUpdateMs = nowMs;
    return shown;
  };

  return {
    update,
    reset,
    get value() {
      return shown;
    },
  };
};
