import { describe, expect, it } from 'vitest';
import { createDistanceSmoother } from '../distanceSmoother';

describe('distanceSmoother', () => {
  it('starts at the first distance it sees', () => {
    const s = createDistanceSmoother();
    expect(s.update(42, true, 0)).toBe(42);
    expect(s.value).toBe(42);
  });

  it('eases toward a jumped sample instead of snapping to it', () => {
    const s = createDistanceSmoother({ tauSeconds: 0.2 });
    s.update(0, true, 0);
    // A new sample 10 m ahead lands; one 60 ms render frame later the boat has
    // moved toward it but is NOT teleported onto it (that was the old snap).
    const after = s.update(10, true, 60);
    expect(after).toBeGreaterThan(0);
    expect(after).toBeLessThan(10);
  });

  it('tracks a steady stream smoothly and close to the true distance', () => {
    // Constant 5 m/s, erg sampling every 500 ms, rendered at ~60 fps. The shown
    // distance should hug the true continuous distance (velocity extrapolation
    // fills the gaps between samples) within a small band, and advance by small
    // per-frame steps — no sample-boundary jump.
    const s = createDistanceSmoother({ tauSeconds: 0.12 });
    const speed = 5; // m/s
    let lastSample = 0;
    let prev = s.update(0, true, 0);
    let maxStep = 0;
    for (let t = 16; t <= 6000; t += 16) {
      // The authoritative distance only updates on 500 ms sample boundaries.
      if (t - lastSample >= 500) lastSample = Math.floor(t / 500) * 500;
      const raw = (lastSample / 1000) * speed;
      const v = s.update(raw, true, t);
      maxStep = Math.max(maxStep, v - prev);
      prev = v;
      if (t >= 2000) {
        // After warm-up, stay within ~1.5 m of the true continuous distance.
        expect(Math.abs(v - (t / 1000) * speed)).toBeLessThan(1.5);
      }
    }
    // The biggest single-frame advance stays small — a 16 ms step at 5 m/s is
    // ~0.08 m; the old snap would have moved a whole ~2.5 m sample at once.
    expect(maxStep).toBeLessThan(0.5);
  });

  it('never moves the boat backward while the row is live', () => {
    const s = createDistanceSmoother({ tauSeconds: 0.2 });
    s.update(100, true, 0);
    // Extrapolate forward between samples (two prior samples set a speed).
    s.update(100, true, 10);
    s.update(110, true, 500); // sample: ~20 m/s over 0.5 s
    let prev = s.value;
    // Many frames pass with no new sample: extrapolation caps and the boat
    // coasts, but it must be monotonic non-decreasing throughout.
    for (let t = 520; t <= 3000; t += 16) {
      const v = s.update(110, true, t);
      expect(v).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = v;
    }
  });

  it('snaps back when the authoritative distance resets (a new row)', () => {
    const s = createDistanceSmoother();
    s.update(0, true, 0);
    s.update(500, true, 1000);
    // Distance drops to ~0 — a new session, not motion. Snap, do not ease.
    expect(s.update(0, true, 2000)).toBe(0);
    expect(s.value).toBe(0);
  });

  it('caps extrapolation so a paused erg coasts to a stop', () => {
    const s = createDistanceSmoother({ tauSeconds: 0.05, maxExtrapSampleIntervals: 1.5 });
    s.update(0, true, 0);
    s.update(0, true, 100);
    s.update(5, true, 500); // 5 m over the 0.4 s interval → 12.5 m/s
    // Let it settle far past the cap. Target is capped at sample.d + speed *
    // (interval * 1.5) = 5 + 12.5 * 0.6 = 12.5 m; the boat must not sail past.
    let v = 0;
    for (let t = 520; t <= 5000; t += 16) v = s.update(5, true, t);
    expect(v).toBeLessThanOrEqual(12.5 + 1e-6);
    expect(v).toBeCloseTo(12.5, 1);
  });

  it('follows the raw distance (no forward-only, no extrapolation) when not playing', () => {
    const s = createDistanceSmoother({ tauSeconds: 0.1 });
    s.update(50, true, 0);
    // Paused: the target is the raw value, and the boat may ease down toward it
    // (the forward-only clamp only applies while playing).
    let v = 50;
    for (let t = 16; t <= 1000; t += 16) v = s.update(40, false, t);
    expect(v).toBeCloseTo(40, 1);
  });

  it('is safe against dt=0 and non-finite input', () => {
    const s = createDistanceSmoother();
    s.update(10, true, 1000);
    expect(s.update(10, true, 1000)).toBe(10); // dt = 0 → no NaN
    expect(Number.isFinite(s.update(Number.NaN, true, 1016))).toBe(true);
    expect(s.value).toBeCloseTo(10, 5);
  });

  it('reset() forces the shown distance', () => {
    const s = createDistanceSmoother();
    s.update(0, true, 0);
    s.update(200, true, 1000);
    s.reset(7, 2000);
    expect(s.value).toBe(7);
    expect(s.update(7, true, 2016)).toBeCloseTo(7, 5);
  });
});
