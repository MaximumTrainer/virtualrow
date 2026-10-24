import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { RouteCurve } from '../../renderer/math/curve';
import { vec3 } from '../../renderer/math/vec3';
import { computePlacements, keepsKitTrees, distinctProfiles, thinToCeiling, MAX_INSTANCES_PER_SIDE } from '../sceneryPlacement';
import { computePlacements as reactComputePlacements } from '../../../components/rower3d/sceneryPlacement';
import { resolveSceneryModels } from '../../../components/rower3d/sceneryAssets';

describe('sceneryPlacement parity with React', () => {
  const points: readonly [number, number, number][] = [
    [0, 0, 0], [0, 0, -200], [0, 0, -400], [0, 0, -600], [0, 0, -800], [0, 0, -1000],
  ];
  const engineCurve = new RouteCurve(points.map(([x, y, z]) => vec3(x, y, z)), false);
  const threeCurve = new THREE.CatmullRomCurve3(
    points.map(([x, y, z]) => new THREE.Vector3(x, y, z)),
    false, 'catmullrom', 0.5,
  );
  const resolved = resolveSceneryModels('fallback', 'river', ['oak']);
  const resolvedByProfile = new Map([['fallback' as const, resolved]]);

  it('matches on count, ids, and progress for each placement', () => {
    const ours = computePlacements({ curve: engineCurve, resolvedByProfile, budget: 1, side: 'left' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const theirs = reactComputePlacements({ curve: threeCurve as any, resolvedByProfile, budget: 1, side: 'left' });
    expect(ours.length).toBe(theirs.length);
    for (let i = 0; i < ours.length; i += 1) {
      expect(ours[i].id).toBe(theirs[i].id);
      expect(ours[i].progress).toBeCloseTo(theirs[i].progress, 6);
      expect(ours[i].scale).toBeCloseTo(theirs[i].scale, 6);
      // Positions diverge only by the small numeric error between THREE's
      // Catmull-Rom and the engine's hand-rolled port on a straight polyline.
      expect(Math.abs(ours[i].position[0] - theirs[i].position[0])).toBeLessThan(1);
      expect(Math.abs(ours[i].position[2] - theirs[i].position[2])).toBeLessThan(1);
    }
  });

  it('both sides produce distinct bank distributions', () => {
    const left = computePlacements({ curve: engineCurve, resolvedByProfile, budget: 1, side: 'left' });
    const right = computePlacements({ curve: engineCurve, resolvedByProfile, budget: 1, side: 'right' });
    expect(left.length).toBeGreaterThan(0);
    expect(right.length).toBeGreaterThan(0);
    // Left bank x < 0, right bank x > 0.
    for (const p of left) expect(p.position[0]).toBeLessThanOrEqual(0);
    for (const p of right) expect(p.position[0]).toBeGreaterThanOrEqual(0);
  });

  it('keepsKitTrees gates the GLB trees to high/extra-high', () => {
    expect(keepsKitTrees('basic')).toBe(false);
    expect(keepsKitTrees('low')).toBe(false);
    expect(keepsKitTrees('medium')).toBe(false);
    expect(keepsKitTrees('high')).toBe(true);
    expect(keepsKitTrees('extra-high')).toBe(true);
  });

  it('distinctProfiles returns a track’s profiles when supplied', () => {
    const track = { bands: [
      { untilProgress: 1, profile: 'forest' as const, water: 'river' as const, label: 'all' },
    ]};
    expect(distinctProfiles(null, track)).toEqual(['forest']);
    expect(distinctProfiles(null)).toEqual(['fallback']);
  });

  it('flat-mode (no curve) still produces placements for the fallback bank', () => {
    const flat = computePlacements({ curve: null, resolvedByProfile, budget: 1, side: 'left' });
    const flatRight = computePlacements({ curve: null, resolvedByProfile, budget: 1, side: 'right' });
    expect(flat.length).toBeGreaterThan(0);
    expect(flatRight.length).toBeGreaterThan(0);
    for (const p of flat) expect(p.position[0]).toBeLessThanOrEqual(0);
    for (const p of flatRight) expect(p.position[0]).toBeGreaterThanOrEqual(0);
  });

  it('curve mode with kitTrees=false skips the tree slots', () => {
    const withTrees = computePlacements({ curve: engineCurve, resolvedByProfile, budget: 1, side: 'left', kitTrees: true });
    const withoutTrees = computePlacements({ curve: engineCurve, resolvedByProfile, budget: 1, side: 'left', kitTrees: false });
    const treeCount = (list: typeof withTrees) => list.filter((p) => resolved.trees.includes(p.id)).length;
    expect(treeCount(withTrees)).toBeGreaterThan(0);
    expect(treeCount(withoutTrees)).toBe(0);
  });

  it('consumes enrichment-derived segment profiles with left-shore widths', () => {
    const enrichment = {
      source: 'overpass' as const,
      enrichedAt: 0,
      elevations: [],
      waterBodyType: 'river' as const,
      waterWidthMeters: 40,
      segmentProfiles: Array.from({ length: 4 }, () => ({
        waterBodyType: 'river' as const,
        waterWidthMeters: 40,
        leftShoreMeters: 20,
        rightShoreMeters: 20,
        waterBodyName: null as string | null,
        dragModifier: 1,
        elevationMeters: 0,
        windModifier: 1,
        onMappedWater: true,
        mappedWaterType: 'river' as const,
        mappedWaterSource: 'overpass' as const,
        sceneryProfile: 'residential' as const,
        treeDensity: 0.5,
        vegetationDensity: 0.5,
        buildingDensity: 0.5,
        objectScale: 1,
      })),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    const residentialResolved = resolveSceneryModels('residential', 'river', ['oak']);
    const map = new Map([['residential' as const, residentialResolved]]);
    const placements = computePlacements({ curve: engineCurve, enrichment, resolvedByProfile: map, budget: 1, side: 'left' });
    expect(placements.length).toBeGreaterThan(0);
  });

  it('thinToCeiling never exceeds the cap and preserves ordering', () => {
    const many = Array.from({ length: MAX_INSTANCES_PER_SIDE + 100 }, (_, i) => ({
      id: `m-${i}`, position: [i, 0, 0] as [number, number, number], rotationY: 0, scale: 1, progress: i / 1000, footing: 'bank' as const,
    }));
    const thinned = thinToCeiling(many);
    expect(thinned.length).toBeLessThanOrEqual(MAX_INSTANCES_PER_SIDE);
    // Monotonic in `position[0]` since we stride through the input.
    for (let i = 1; i < thinned.length; i += 1) {
      expect(thinned[i].position[0]).toBeGreaterThan(thinned[i - 1].position[0]);
    }
  });
});
