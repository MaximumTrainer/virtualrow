import { describe, expect, it } from 'vitest';
import { buildWaterStrip, WATER_SURFACE_Y } from '../waterStrip';
import { RouteCurve } from '../../math/curve';
import { vec3 } from '../../math/vec3';

describe('buildWaterStrip', () => {
  describe('null curve (smoke-page fallback)', () => {
    it('returns a straight ±halfWidth strip along −Z', () => {
      const { positions, indices } = buildWaterStrip(null, { halfWidth: 20, length: 400, divisions: 2 });
      // 3 vertex columns × 2 verts × xyz
      expect(positions.length).toBe(3 * 2 * 3);
      // Left edge at (−20, Y, z), right at (+20, Y, z); the columns step through 0, −200, −400.
      expect(positions[0]).toBeCloseTo(-20);
      expect(positions[1]).toBeCloseTo(WATER_SURFACE_Y);
      expect(positions[2]).toBeCloseTo(0);
      expect(positions[3]).toBeCloseTo(20);
      expect(positions[5]).toBeCloseTo(0);
      expect(positions[6 + 2]).toBeCloseTo(-200); // mid column z
      expect(positions[12 + 2]).toBeCloseTo(-400); // far column z
      // Two triangles per division, two divisions = 12 indices.
      expect(indices.length).toBe(12);
      expect(indices).toBeInstanceOf(Uint16Array);
    });

    it('honours an asymmetric edgesForProgress on the fallback strip', () => {
      const { positions } = buildWaterStrip(null, {
        divisions: 2,
        length: 100,
        edgesForProgress: () => ({ left: 5, right: 15 }),
      });
      expect(positions[0]).toBeCloseTo(-5);
      expect(positions[3]).toBeCloseTo(15);
    });
  });

  describe('curve-aligned strip', () => {
    const sKey = (xs: number[], ys: number[], zs: number[]) =>
      xs.map((_, i) => `${xs[i].toFixed(2)}|${ys[i].toFixed(2)}|${zs[i].toFixed(2)}`).join(';');

    it('bends with a curved route — left and right vertices sit perpendicular to the local tangent', () => {
      // 90° arc in the XZ plane around origin at radius 100.
      const points = [];
      for (let i = 0; i <= 8; i += 1) {
        const a = (i / 8) * (Math.PI / 2);
        points.push(vec3(100 * Math.sin(a), 0, -100 * Math.cos(a)));
      }
      const curve = new RouteCurve(points, false);
      const { positions } = buildWaterStrip(curve, { halfWidth: 10, divisions: 8 });

      // For each column, left and right should be ±perp from the sampled centre,
      // and the midpoint should match curve.sample(t).position.
      for (let i = 0; i <= 8; i += 1) {
        const o = i * 6;
        const lx = positions[o];
        const lz = positions[o + 2];
        const rx = positions[o + 3];
        const rz = positions[o + 5];
        // Midpoint of the strip must sit on the curve.
        const smp = curve.sample(i / 8);
        expect((lx + rx) / 2).toBeCloseTo(smp.position[0], 3);
        expect((lz + rz) / 2).toBeCloseTo(smp.position[2], 3);
        // Edge-to-edge chord equals full width (= 2 × halfWidth), to within the arc's own curvature error.
        const chord = Math.hypot(rx - lx, rz - lz);
        expect(chord).toBeGreaterThan(19.9);
        expect(chord).toBeLessThan(20.1);
      }
    });

    it('places all vertices at WATER_SURFACE_Y and emits sky-facing winding', () => {
      const curve = new RouteCurve([vec3(0, 0, 0), vec3(0, 0, -200)], false);
      const { positions, indices } = buildWaterStrip(curve, { divisions: 4 });
      for (let i = 1; i < positions.length; i += 3) {
        expect(positions[i]).toBeCloseTo(WATER_SURFACE_Y);
      }
      // Winding matches the sky-facing (0,b,0,b+2) / (b+1,b+3,b+2) pattern.
      expect([indices[0], indices[1], indices[2]]).toEqual([0, 1, 2]);
      expect([indices[3], indices[4], indices[5]]).toEqual([1, 3, 2]);
      // Different output than a null-curve smoke run would produce.
      const smoke = buildWaterStrip(null, { divisions: 4, halfWidth: 20, length: 200 });
      expect(sKey([positions[0]], [positions[1]], [positions[2]]))
        .toBe(sKey([smoke.positions[0]], [smoke.positions[1]], [smoke.positions[2]]));
    });

    it('applies asymmetric per-progress widths from edgesForProgress', () => {
      const curve = new RouteCurve([vec3(0, 0, 0), vec3(0, 0, -100)], false);
      const { positions } = buildWaterStrip(curve, {
        divisions: 2,
        edgesForProgress: (t) => ({ left: 5 + 10 * t, right: 25 - 10 * t }),
      });
      // At t=0: left=5, right=25 → width 30 but centred around curve midpoint.
      // Perp for a straight −Z curve is (−1, 0, 0): left edge is at +X direction, right at −X.
      // The implementation uses point − perp*left on one side and point + perp*right on the other, so:
      const chord0 = Math.hypot(positions[3] - positions[0], positions[5] - positions[2]);
      expect(chord0).toBeCloseTo(30, 3);
      const chord1 = Math.hypot(positions[12 + 3] - positions[12], positions[12 + 5] - positions[12 + 2]);
      expect(chord1).toBeCloseTo(30, 3);
      // Asymmetric shores shift the water's visible centre off the GPS curve
      // (midpoint = curve + perp * (right − left) / 2), which mirrors
      // routeEnrichmentService.getWaterEdgesSceneUnitsForProgress's intent:
      // the route need not run down the water's middle. At t=0 left=5,
      // right=25, perp = (−1, 0, 0), so midpoint x = +10.
      expect((positions[0] + positions[3]) / 2).toBeCloseTo(10, 3);
    });
  });

  it('defaults divisions along the curve to one column per ~10 m of route', () => {
    // Curve ≈ 1000 m chord → ≥100 divisions picked by the length-scaled default.
    const curve = new RouteCurve(
      [vec3(0, 0, 0), vec3(0, 0, -500), vec3(0, 0, -1000)].map((v) => v),
      false,
    );
    const { positions } = buildWaterStrip(curve);
    const vertexColumns = positions.length / 6;
    // Minimum 128 columns, more for a longer route.
    expect(vertexColumns).toBeGreaterThanOrEqual(128);
    // At one column per 10 m on a ~1000 m route, ≥100 columns is the floor.
    expect(vertexColumns).toBeGreaterThan(99);
  });

  it('defaults divisions to at least 2 even when the caller asks for less', () => {
    const { positions, indices } = buildWaterStrip(null, { divisions: 1 });
    // Floor is 2, so vertex columns = 3.
    expect(positions.length).toBe(3 * 2 * 3);
    expect(indices.length).toBe(2 * 6);
  });
});
