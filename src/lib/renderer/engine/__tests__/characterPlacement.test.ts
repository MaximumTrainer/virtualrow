import { describe, expect, it } from 'vitest';
import { RouteCurve } from '../../math/curve';
import { vec3 } from '../../math/vec3';
import {
  createPlacement,
  placeBoat,
  placeGhost,
  strokeAmplitude,
  strokePhase,
} from '../characterPlacement';
import type { RideFrame } from '../rideFrame';
import { paceGhost, recordedGhost } from '../../../../components/rower3d/ghost';

// A straight 200 m route from origin heading −z. One sample per metre is
// plenty for the assertions here.
const straightCurve = (): RouteCurve =>
  new RouteCurve([vec3(0, 0, 0), vec3(0, 0, -200)], false);

const makeFrame = (patch: Partial<RideFrame> = {}): RideFrame => ({
  paceSPer500: 120,
  distanceMeters: 50,
  cadence: 24,
  isPlaying: true,
  holdBoat: false,
  finished: false,
  intensityFactor: 1,
  elapsedSeconds: 10,
  ghost: null,
  ...patch,
});

describe('characterPlacement', () => {
  it('places the boat at origin when no curve or frame is given', () => {
    const out = createPlacement();
    placeBoat(out, null, null, 1000, 1000);
    expect(out.progress).toBe(0);
    expect(out.distanceMeters).toBe(0);
    expect(out.world[0]).toBe(0);
  });

  it('pins progress to 0 while holdBoat is true', () => {
    const curve = straightCurve();
    const out = createPlacement();
    placeBoat(out, curve, makeFrame({ holdBoat: true, distanceMeters: 500 }), 1000, 200);
    expect(out.progress).toBe(0);
  });

  it('pins progress to 1 when finished', () => {
    const curve = straightCurve();
    const out = createPlacement();
    placeBoat(out, curve, makeFrame({ finished: true, distanceMeters: 10 }), 1000, 200);
    expect(out.progress).toBe(1);
  });

  it('advances progress proportionally with distance', () => {
    const curve = straightCurve();
    const out = createPlacement();
    placeBoat(out, curve, makeFrame({ distanceMeters: 500 }), 1000, 200);
    expect(out.progress).toBeCloseTo(0.5, 5);
    expect(out.distanceMeters).toBe(500);
  });

  it('clamps progress to [0,1]', () => {
    const curve = straightCurve();
    const out = createPlacement();
    placeBoat(out, curve, makeFrame({ distanceMeters: 5000 }), 1000, 200);
    expect(out.progress).toBe(1);
  });

  it('places the ghost from ghostDistanceAt with a pace ghost', () => {
    const curve = straightCurve();
    const out = createPlacement();
    const info = placeGhost(out, curve, paceGhost(120), 60, 1000, 200, 0);
    expect(info).not.toBeNull();
    // 60 s @ 120 s/500 m → 500/120 * 60 = 250 m.
    expect(info!.metres).toBeCloseTo(250, 1);
  });

  it('places the ghost from ghostDistanceAt with a recorded ghost', () => {
    const curve = straightCurve();
    const out = createPlacement();
    const g = recordedGhost([
      { t: 0, distance: 0 },
      { t: 60, distance: 240 },
    ]);
    const info = placeGhost(out, curve, g, 60, 1000, 200, -2.5);
    expect(info).not.toBeNull();
    expect(info!.metres).toBeCloseTo(240, 1);
  });

  it('returns null when there is no ghost source', () => {
    const curve = straightCurve();
    const out = createPlacement();
    expect(placeGhost(out, curve, null, 60, 1000, 200, -2.5)).toBeNull();
  });

  it('strokePhase returns zero when not playing', () => {
    expect(strokePhase(24, 100, false)).toBe(0);
  });

  it('strokePhase cycles with cadence', () => {
    const spm = 30; // 0.5 Hz
    // One full cycle at 2 s should wrap back to ~0.
    expect(strokePhase(spm, 2, true)).toBeCloseTo(0, 5);
    // Half a cycle at 1 s should be ~0.5.
    expect(strokePhase(spm, 1, true)).toBeCloseTo(0.5, 5);
  });

  it('strokeAmplitude clamps intensityFactor into [0, 1]', () => {
    expect(strokeAmplitude(null)).toBe(0);
    expect(strokeAmplitude(makeFrame({ isPlaying: false }))).toBe(0);
    expect(strokeAmplitude(makeFrame({ intensityFactor: 0.5 }))).toBe(0.5);
    expect(strokeAmplitude(makeFrame({ intensityFactor: 2 }))).toBe(1);
    expect(strokeAmplitude(makeFrame({ intensityFactor: -1 }))).toBe(0);
    expect(strokeAmplitude(makeFrame({ intensityFactor: Number.NaN }))).toBe(1);
  });
});
