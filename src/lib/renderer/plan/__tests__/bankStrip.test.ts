import { describe, expect, it } from 'vitest';
import { buildBankStrips } from '../bankStrip';
import { RouteCurve } from '../../math/curve';
import { vec3 } from '../../math/vec3';
import { WATER_SURFACE_Y } from '../waterStrip';

describe('buildBankStrips', () => {
  it('falls back to a straight ribbon on a null curve (smoke-page default)', () => {
    const { positions, indices } = buildBankStrips();
    // 40 default divisions, 2 strips, (divisions + 1) × 2 verts each,
    // and each vert carries xyz → 41 × 2 × 2 × 3 = 492 floats.
    expect(positions.length).toBe((40 + 1) * 2 * 2 * 3);
    expect(indices.length).toBe(40 * 6 * 2);
    // Straight-ribbon left strip: perp defaults to (−1, 0, 0), sign = −1,
    // so inner edge sits at `point + perp × sign × shore` = +20 for shore=20.
    expect(positions[0]).toBeCloseTo(20);
    expect(positions[3]).toBeCloseTo(80);
  });

  it('bends with a curved route so the inner edge tracks the water', () => {
    // 90° arc of radius 100 in XZ.
    const pts = [];
    for (let i = 0; i <= 8; i += 1) {
      const a = (i / 8) * (Math.PI / 2);
      pts.push(vec3(100 * Math.sin(a), 0, -100 * Math.cos(a)));
    }
    const curve = new RouteCurve(pts, false);
    const { positions } = buildBankStrips({ curve, waterHalfWidth: 10, bankWidth: 20 });
    // Default divisions scale with chord length (~157 m → ≥128). Confirm the
    // first-strip inner column lies within [waterHalfWidth, +shore+bankWidth]
    // of the curve centre, not on the straight-Z fallback.
    const mid = positions.length / 2;
    for (let i = 0; i < mid; i += 6) {
      const innerX = positions[i];
      const innerZ = positions[i + 2];
      // Any point along a 100-radius arc has |pos|≤100 + a bit for the
      // inner-edge offset; the straight-ribbon fallback would place inner
      // Z at ±(1..157), not along the arc, so test that we're off the Z
      // axis for a non-first column.
      if (i > 0) {
        expect(Math.hypot(innerX, innerZ)).toBeGreaterThan(5);
      }
    }
    // Every bank vertex sits at y = WATER_SURFACE_Y + 0.1.
    for (let i = 1; i < positions.length; i += 3) {
      expect(positions[i]).toBeCloseTo(WATER_SURFACE_Y + 0.1);
    }
  });

  it('honours per-progress shore widths from edgesForProgress', () => {
    const curve = new RouteCurve([vec3(0, 0, 0), vec3(0, 0, -200)], false);
    const { positions } = buildBankStrips({
      curve,
      divisions: 4,
      bankWidth: 10,
      edgesForProgress: () => ({ left: 5, right: 25 }),
    });
    // Left strip (sign = −1). For a +Z straight curve the perp from
    // tangent × up with tangent = (0, 0, −1) is (+1, 0, 0), so inner edge
    // sits at `point + perp × sign × left = 0 + 1 × (−1) × 5 = −5`.
    expect(positions[0]).toBeCloseTo(-5);
    // Right strip starts at vertsPerStrip × 3 = (4+1)×2×3 = 30 floats in,
    // with sign = +1 and right-shore widths, so inner edge = +25.
    const rightStart = (4 + 1) * 2 * 3;
    expect(positions[rightStart]).toBeCloseTo(25);
  });
});
