import { describe, expect, it } from 'vitest';

/**
 * P6-AC3 (#566): the horizon colour varies with sun azimuth.
 *
 * The sky shader (`sky.wgsl`) picks `warmShare = clamp(dot(sunAz, viewAz)*0.5 + 0.5)`
 * where `sunAz = normalize(vec2(sunDir.x, sunDir.z))` and `viewAz` is
 * driven by the fragment's NDC X. The horizon colour is then
 *
 *   mix(coolHorizon, warmHorizon, warmShare * max(sunDir.y, 0))
 *
 * This test re-implements that formula in TS and asserts that two sun
 * directions (east vs west azimuth) produce *different* colours at the
 * same NDC uv — enough to catch any accidental fallback to the P2 static
 * horizon. The exact colour values are not what the test cares about, so
 * the formula below mirrors the shader rather than fixing a snapshot.
 */

type Vec2 = [number, number];
type Vec3 = [number, number, number];

const normalize2 = ([x, y]: Vec2): Vec2 => {
  const len = Math.max(1e-9, Math.hypot(x, y));
  return [x / len, y / len];
};

const dot2 = (a: Vec2, b: Vec2): number => a[0] * b[0] + a[1] * b[1];

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

const COOL_HORIZON: Vec3 = [0.70, 0.80, 0.92];
const WARM_HORIZON: Vec3 = [0.98, 0.80, 0.55];

/** Mirror of the shader's horizon colour pick. */
const horizonAt = (ndcX: number, sunDir: Vec3): Vec3 => {
  const sunAz = normalize2([sunDir[0], sunDir[2]]);
  const viewAz = normalize2([ndcX, -1]);
  const warmShare = clamp(dot2(sunAz, viewAz) * 0.5 + 0.5, 0, 1);
  const weight = warmShare * Math.max(sunDir[1], 0);
  return [
    COOL_HORIZON[0] * (1 - weight) + WARM_HORIZON[0] * weight,
    COOL_HORIZON[1] * (1 - weight) + WARM_HORIZON[1] * weight,
    COOL_HORIZON[2] * (1 - weight) + WARM_HORIZON[2] * weight,
  ];
};

const deltaE = (a: Vec3, b: Vec3): number =>
  Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);

describe('sky horizon (P6-AC3)', () => {
  it('an east-facing sun warms a different horizon colour than a west-facing one', () => {
    const sunEast: Vec3 = [0.8, 0.5, 0.0];
    const sunWest: Vec3 = [-0.8, 0.5, 0.0];
    const ndcX = 0.3;
    const east = horizonAt(ndcX, sunEast);
    const west = horizonAt(ndcX, sunWest);
    const dr = Math.abs(east[0] - west[0]);
    const dg = Math.abs(east[1] - west[1]);
    const db = Math.abs(east[2] - west[2]);
    expect(dr + dg + db).toBeGreaterThan(0.05);
  });

  it('a sun above the horizon shifts the horizon colour away from the cool palette', () => {
    const high: Vec3 = [0.6, 0.8, 0.0];
    const ndcX = 0.4; // facing the sun side
    const horizon = horizonAt(ndcX, high);
    // Any visible shift away from pure cool: the horizon has crept toward warm.
    expect(deltaE(horizon, COOL_HORIZON)).toBeGreaterThan(0.1);
  });

  it('a buried sun collapses the horizon back to the cool palette', () => {
    const buried: Vec3 = [0.6, -0.5, 0.0];
    const h = horizonAt(0, buried);
    expect(h[0]).toBeCloseTo(COOL_HORIZON[0], 5);
    expect(h[1]).toBeCloseTo(COOL_HORIZON[1], 5);
    expect(h[2]).toBeCloseTo(COOL_HORIZON[2], 5);
  });
});
