import { describe, it, expect } from 'vitest';
import { easeProgressTowards, PROGRESS_EASE_PER_SECOND } from '../components/rower3d/progressEasing';

/**
 * Issue #295 — the easing that follows the reported distance while a session is
 * paused diverged on a slow frame.
 *
 * `progress += (target - progress) * delta * 3` is a first-order filter whose
 * gain is `3 * delta`. Stable under 1, oscillating past it, and divergent past
 * 2 — so on a frame longer than 0.667s each step overshot further than the one
 * before. #272 records frame p95 figures of 2784 ms and 6902 ms on the
 * rasteriser CI uses, so this is the regime the project already measures.
 */

/** The long frames #272 measured, in seconds. */
const SLOW_FRAME = 2.784;
const VERY_SLOW_FRAME = 6.902;

describe('easing the boat towards the reported distance (#295)', () => {
  it('closes on the target without ever passing it', () => {
    let progress = 0;
    for (let i = 0; i < 20; i += 1) {
      progress = easeProgressTowards(progress, 1, 0.1);
      expect(progress, 'the boat overshot the distance the rower had covered')
        .toBeLessThanOrEqual(1);
      expect(progress).toBeGreaterThanOrEqual(0);
    }
    expect(progress).toBeGreaterThan(0.9);
  });

  it('arrives rather than oscillating when a frame takes seconds', () => {
    // The old gain here was 3 * 2.784 = 8.35, which threw the boat a long way
    // past the target and further back again on the next frame.
    const seen: number[] = [];
    let progress = 0;
    for (let i = 0; i < 6; i += 1) {
      progress = easeProgressTowards(progress, 0.5, SLOW_FRAME);
      seen.push(progress);
    }

    for (const value of seen) {
      expect(value, `progress left the route: ${seen.map((v) => v.toFixed(2)).join(', ')}`)
        .toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
    expect(seen[seen.length - 1]).toBeCloseTo(0.5, 5);
  });

  it('does not diverge on the longest frame the project has measured', () => {
    let progress = 0.2;
    for (let i = 0; i < 10; i += 1) {
      progress = easeProgressTowards(progress, 0.6, VERY_SLOW_FRAME);
    }

    expect(progress).toBeCloseTo(0.6, 5);
  });

  it('never moves backwards while the target is ahead', () => {
    // The symptom a rower would report: the boat jittering rather than easing.
    let progress = 0;
    let previous = -1;
    for (let i = 0; i < 12; i += 1) {
      progress = easeProgressTowards(progress, 0.8, 1.0);
      expect(progress, 'the boat went backwards while the target was ahead')
        .toBeGreaterThanOrEqual(previous);
      previous = progress;
    }
  });

  it('holds still when a frame reports no time, or nonsense', () => {
    expect(easeProgressTowards(0.3, 0.9, 0)).toBe(0.3);
    expect(easeProgressTowards(0.3, 0.9, -1)).toBe(0.3);
    expect(easeProgressTowards(0.3, 0.9, Number.NaN)).toBe(0.3);
    expect(easeProgressTowards(0.3, Number.NaN, 0.1)).toBe(0.3);
  });

  it('keeps the rate it always had on an ordinary frame', () => {
    // Nothing about how this feels at 60 fps should change.
    const sixtyFps = 1 / 60;
    expect(easeProgressTowards(0, 1, sixtyFps)).toBeCloseTo(
      sixtyFps * PROGRESS_EASE_PER_SECOND,
      10,
    );
  });
});
