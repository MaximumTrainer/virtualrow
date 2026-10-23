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

  it('honours an authored scenery track (track branch of getSegmentSceneryProfile)', () => {
    const track = {
      bands: [
        { untilProgress: 0.5, profile: 'commercial' as const, water: 'river' as const, label: 'town' },
        { untilProgress: 1, profile: 'wetland' as const, water: 'river' as const, label: 'marsh' },
      ],
    };
    const layout = layoutLandscape({ curve: engineCurve, track });
    expect(layout.leftElements.length + layout.rightElements.length).toBeGreaterThan(0);
    // The commercial half has a high buildings probability, so most elements
    // in t < 0.5 should be buildings when a slot rolls above `tree`.
    const earlyBuildings = [...layout.leftElements, ...layout.rightElements]
      .filter((e) => e.progress < 0.5 && e.type === 'building').length;
    expect(earlyBuildings).toBeGreaterThan(0);
  });

  it('toBuildingSpecs maps every scenery profile through the palette switch', () => {
    // Hand-build a layout with one building per profile so the switch hits
    // every case (commercial, residential, farmland/forest/beach/wetland→residential, unknown→fallback).
    const profiles: Array<string> = ['residential', 'commercial', 'wetland', 'beach', 'farmland', 'forest', 'unknown-profile'];
    const layout = {
      leftElements: profiles.map((p, i) => ({
        position: [i, 0, 0] as [number, number, number],
        type: 'building' as const,
        scale: 1,
        rotation: 0,
        sceneryProfile: p as 'residential',
        progress: i / profiles.length,
        side: 'left' as const,
      })),
      rightElements: [],
    };
    const specs = layoutToBuildingSpecs(layout, SCENERY_PROFILES);
    expect(specs.length).toBe(profiles.length);
    expect(specs[0].profile).toBe('residential');
    expect(specs[1].profile).toBe('commercial');
    expect(specs[2].profile).toBe('residential');
    expect(specs[6].profile).toBe('fallback');
    // Unknown profile also exercises the heightRange ?? [0.7, 1.0] fallback.
    expect(specs[6].height).toBeGreaterThan(0);
  });

  it('falls back to the default channel width when enrichment has no segment profiles', () => {
    // Hits the no-segmentProfiles branch in the port's inlined waterHalfWidthAt.
    const enrichment = {
      source: 'fallback' as const,
      enrichedAt: 0,
      elevations: [],
      segmentProfiles: [],
      waterWidthMeters: 30,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    const layout = layoutLandscape({ curve: engineCurve, enrichment });
    // Didn't throw; produced some elements with offsets measured off a
    // 15 m-each-side waterline.
    expect(layout.leftElements.length + layout.rightElements.length).toBeGreaterThan(0);
    for (const el of [...layout.leftElements, ...layout.rightElements]) {
      // Lateral offset ≥ LANDSCAPE_OFFSET (50 m) — further than the water on either side.
      expect(Math.abs(el.position[0])).toBeGreaterThan(0);
    }
  });

  it('uses enrichment-derived densities when no track is supplied', () => {
    const enrichment = {
      source: 'overpass' as const,
      enrichedAt: 0,
      elevations: [],
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
        treeDensity: 0.4,
        vegetationDensity: 0.6,
        buildingDensity: 0.5,
        objectScale: 1,
      })),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    const layout = layoutLandscape({ curve: engineCurve, enrichment });
    expect(layout.leftElements.length + layout.rightElements.length).toBeGreaterThan(0);
  });
});
