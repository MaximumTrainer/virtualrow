import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { RouteCurve } from '../../renderer/math/curve';
import { vec3 } from '../../renderer/math/vec3';
import { layoutLandscape, layoutToBuildingSpecs } from '../landscapeLayout';
import { layoutLandscape as reactLayoutLandscape } from '../../../components/rower3d/landscapeLayout';
import { SCENERY_PROFILES } from '../../../components/rower3d/sceneryConfig';

describe('layoutLandscape parity with React', () => {
  const points: readonly [number, number, number][] = [
    [0, 0, 0],
    [0, 0, -200],
    [0, 0, -400],
    [0, 0, -600],
    [0, 0, -800],
    [0, 0, -1000],
  ];
  const engineCurve = new RouteCurve(points.map(([x, y, z]) => vec3(x, y, z)), false);
  const threeCurve = new THREE.CatmullRomCurve3(
    points.map(([x, y, z]) => new THREE.Vector3(x, y, z)),
    false,
    'catmullrom',
    0.5,
  );

  it('matches the React port on counts and types', () => {
    const ours = layoutLandscape({ curve: engineCurve });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const theirs = reactLayoutLandscape({ curve: threeCurve as any });
    expect(ours.leftElements.length).toBe(theirs.leftElements.length);
    expect(ours.rightElements.length).toBe(theirs.rightElements.length);
    for (let i = 0; i < ours.leftElements.length; i += 1) {
      expect(ours.leftElements[i].type).toBe(theirs.leftElements[i].type);
      expect(ours.leftElements[i].progress).toBeCloseTo(theirs.leftElements[i].progress, 6);
    }
    for (let i = 0; i < ours.rightElements.length; i += 1) {
      expect(ours.rightElements[i].type).toBe(theirs.rightElements[i].type);
      expect(ours.rightElements[i].progress).toBeCloseTo(theirs.rightElements[i].progress, 6);
    }
  });

  it('converts facade elements to BuildingSpecs with positive dimensions', () => {
    const layout = layoutLandscape({ curve: engineCurve });
    const specs = layoutToBuildingSpecs(layout, SCENERY_PROFILES);
    const buildingCount =
      [...layout.leftElements, ...layout.rightElements].filter((e) => e.type === 'building').length;
    expect(specs.length).toBe(buildingCount);
    for (const s of specs) {
      expect(s.height).toBeGreaterThan(0);
      expect(s.halfWidth).toBeGreaterThan(0);
      expect(s.halfDepth).toBeGreaterThan(0);
      expect(Number.isFinite(s.x) && Number.isFinite(s.z)).toBe(true);
    }
  });

  it('empty on null curve', () => {
    expect(layoutLandscape({ curve: null })).toEqual({ leftElements: [], rightElements: [] });
    expect(layoutToBuildingSpecs({ leftElements: [], rightElements: [] }, SCENERY_PROFILES)).toEqual([]);
  });
});
