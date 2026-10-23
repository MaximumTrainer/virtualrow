import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { RouteCurve } from '../../renderer/math/curve';
import { vec3 } from '../../renderer/math/vec3';
import { layoutFoliage, batchFoliagePools, FOLIAGE_SHAPES } from '../foliagePlan';
import { layoutFoliage as reactLayoutFoliage } from '../../../components/rower3d/foliagePlan';

/**
 * Parity: the three-free port in `src/lib/scenery/foliagePlan.ts` must produce
 * the same tree-by-tree layout as `src/components/rower3d/foliagePlan.ts` for
 * a fixed route + species list + no enrichment. Both share `seededRandom` and
 * `SCENERY_PROFILES` so the slot-roll, species pick and offset should match
 * exactly; the only degree of freedom is how the curve is sampled, so we feed
 * both sides straight-chord curves whose `sample`/`getPointAt` outputs agree
 * (identity at a straight line in the XZ plane).
 */
describe('layoutFoliage parity with React', () => {
  const linePoints: readonly [number, number, number][] = [
    [0, 0, 0],
    [0, 0, -200],
    [0, 0, -400],
    [0, 0, -600],
    [0, 0, -800],
    [0, 0, -1000],
  ];
  const engineCurve = new RouteCurve(linePoints.map(([x, y, z]) => vec3(x, y, z)), false);
  const threeCurve = new THREE.CatmullRomCurve3(
    linePoints.map(([x, y, z]) => new THREE.Vector3(x, y, z)),
    false,
    'catmullrom',
    0.5,
  );
  const speciesTypes = [...FOLIAGE_SHAPES];
  const reactSpecies = speciesTypes.map((type) => ({ type, color: '#000' }));

  it('produces the same tree count and roughly the same positions', () => {
    const ours = layoutFoliage({ curve: engineCurve, speciesTypes });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const theirs = reactLayoutFoliage({ curve: threeCurve as any, species: reactSpecies as any });
    // Same slot/density logic, so counts match.
    expect(ours.length).toBe(theirs.length);
    // Positions diverge only by the small numeric error between THREE's
    // Catmull-Rom and the engine's hand-rolled port on a straight polyline
    // (both are the same basis), so a per-tree chord of a few cm.
    for (let i = 0; i < ours.length; i += 1) {
      const [ox, , oz] = ours[i].position;
      expect(Math.abs(ox - theirs[i].position[0])).toBeLessThan(0.5);
      expect(Math.abs(oz - theirs[i].position[2])).toBeLessThan(0.5);
      expect(ours[i].species).toBe(theirs[i].species);
    }
  });

  it('batchFoliagePools groups trees into (species, chunk) pools with sane bounds', () => {
    const trees = layoutFoliage({ curve: engineCurve, speciesTypes });
    const pools = batchFoliagePools(trees, speciesTypes.length, 1000, 250);
    expect(pools.length).toBeGreaterThan(0);
    for (const p of pools) {
      expect(p.kind).toBe('foliage');
      expect(p.positions.length).toBe(p.metadata!.length * 3);
      expect(p.bounds.radius).toBeGreaterThan(0);
      expect(p.speciesIndex).toBeGreaterThanOrEqual(0);
      expect(p.speciesIndex).toBeLessThan(speciesTypes.length);
    }
    const total = pools.reduce((n, p) => n + p.metadata!.length, 0);
    expect(total).toBe(trees.length);
  });
});
