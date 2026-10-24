/**
 * Three-free port of the Catmull-Rom route curve used by the three scene
 * (`src/components/rower3d/curve.ts`). Only the geometry the engine needs
 * is here: sample a position and a unit tangent at a normalised progress.
 *
 * The sampling matches three's `CatmullRomCurve3` with tension 0.5 (which
 * `createRouteCurve` uses). An open spline uses mirrored virtual endpoints;
 * a closed loop wraps around. We don't rebuild the arc-length table on
 * every sample — the engine samples uniformly in parameter space (fine for
 * P2 since the UI shell is empty and the route is a canned straight line).
 */

import type { Vec3 } from './vec3';
import { vec3, vec3Normalize, vec3Set, vec3Sub } from './vec3';

export interface CurvePoint {
  position: Vec3;
  tangent: Vec3;
  /** Y-axis heading in radians (atan2(x, z) of the tangent). */
  angle: number;
}

export class RouteCurve {
  private readonly pts: readonly Vec3[];
  private readonly closed: boolean;

  constructor(points: readonly Vec3[], closed = false) {
    this.pts = points;
    this.closed = closed;
  }

  get length(): number {
    return this.pts.length;
  }

  sample(progress: number, out?: CurvePoint): CurvePoint {
    const target = out ?? {
      position: vec3(),
      tangent: vec3(0, 0, -1),
      angle: 0,
    };
    const n = this.pts.length;
    if (n === 0) {
      vec3Set(target.position, 0, 0, 0);
      vec3Set(target.tangent, 0, 0, -1);
      target.angle = 0;
      return target;
    }
    if (n === 1) {
      target.position[0] = this.pts[0][0];
      target.position[1] = this.pts[0][1];
      target.position[2] = this.pts[0][2];
      vec3Set(target.tangent, 0, 0, -1);
      target.angle = 0;
      return target;
    }

    const t = Math.max(0, Math.min(1, progress));
    const segments = this.closed ? n : n - 1;
    const u = t * segments;
    const i = Math.min(Math.floor(u), segments - (this.closed ? 0 : 1));
    const localT = u - i;

    const p0 = this.get(i - 1);
    const p1 = this.get(i);
    const p2 = this.get(i + 1);
    const p3 = this.get(i + 2);

    const tt = localT * localT;
    const ttt = tt * localT;

    // Catmull-Rom basis with tension 0.5.
    const b0 = -0.5 * ttt + tt - 0.5 * localT;
    const b1 = 1.5 * ttt - 2.5 * tt + 1;
    const b2 = -1.5 * ttt + 2 * tt + 0.5 * localT;
    const b3 = 0.5 * ttt - 0.5 * tt;

    target.position[0] = b0 * p0[0] + b1 * p1[0] + b2 * p2[0] + b3 * p3[0];
    target.position[1] = b0 * p0[1] + b1 * p1[1] + b2 * p2[1] + b3 * p3[1];
    target.position[2] = b0 * p0[2] + b1 * p1[2] + b2 * p2[2] + b3 * p3[2];

    // Tangent from derivative of the basis.
    const d0 = -1.5 * tt + 2 * localT - 0.5;
    const d1 = 4.5 * tt - 5 * localT;
    const d2 = -4.5 * tt + 4 * localT + 0.5;
    const d3 = 1.5 * tt - localT;

    target.tangent[0] = d0 * p0[0] + d1 * p1[0] + d2 * p2[0] + d3 * p3[0];
    target.tangent[1] = d0 * p0[1] + d1 * p1[1] + d2 * p2[1] + d3 * p3[1];
    target.tangent[2] = d0 * p0[2] + d1 * p1[2] + d2 * p2[2] + d3 * p3[2];
    vec3Normalize(target.tangent, target.tangent);

    target.angle = Math.atan2(target.tangent[0], target.tangent[2]);
    return target;
  }

  /** Length of the curve, approximated by a straight sum of segment chords. */
  approximateLength(samples = 64): number {
    if (this.pts.length < 2) return 0;
    const a = vec3();
    const b = vec3();
    let total = 0;
    this.sample(0, { position: a, tangent: vec3(), angle: 0 });
    for (let i = 1; i <= samples; i++) {
      this.sample(i / samples, { position: b, tangent: vec3(), angle: 0 });
      const diff = vec3();
      vec3Sub(diff, b, a);
      total += Math.hypot(diff[0], diff[1], diff[2]);
      a[0] = b[0];
      a[1] = b[1];
      a[2] = b[2];
    }
    return total;
  }

  private get(index: number): Vec3 {
    const n = this.pts.length;
    if (this.closed) {
      return this.pts[((index % n) + n) % n];
    }
    if (index < 0) {
      // Mirror the second point across the first for a plausible virtual endpoint.
      const first = this.pts[0];
      const second = this.pts[1] ?? first;
      const out = vec3();
      out[0] = 2 * first[0] - second[0];
      out[1] = 2 * first[1] - second[1];
      out[2] = 2 * first[2] - second[2];
      return out;
    }
    if (index >= n) {
      const last = this.pts[n - 1];
      const prev = this.pts[n - 2] ?? last;
      const out = vec3();
      out[0] = 2 * last[0] - prev[0];
      out[1] = 2 * last[1] - prev[1];
      out[2] = 2 * last[2] - prev[2];
      return out;
    }
    return this.pts[index];
  }
}
