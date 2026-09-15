import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import * as THREE from 'three';
import {
  COURSE_FURNITURE,
  LIVERIED_LANDMARKS,
  courseStructures,
  landmarkStructures,
  crossingStructures,
  computeStructurePlacements,
} from '../components/rower3d/sceneryStructures';
import type { Crossing } from '../utils/bridgeCrossings';

const curve = new THREE.CatmullRomCurve3([
  new THREE.Vector3(0, 0, -200),
  new THREE.Vector3(10, 0, -100),
  new THREE.Vector3(-10, 0, 0),
  new THREE.Vector3(10, 0, 100),
  new THREE.Vector3(0, 0, 200),
]);

const assetExists = (id: string) =>
  ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'l'].some((tier) =>
    fs.existsSync(path.join(process.cwd(), 'public/assets/scenery', `tier-${tier}`, `${id}.glb`)),
  );

describe('course furniture', () => {
  it('names models that exist', () => {
    const ids = [...COURSE_FURNITURE.start, ...COURSE_FURNITURE.finish];

    expect(ids.length).toBeGreaterThan(0);
    expect(ids.filter((id) => !assetExists(id))).toEqual([]);
  });

  it('draws on the Tier A and Tier B kits that nothing could reach before', () => {
    const ids = [...COURSE_FURNITURE.start, ...COURSE_FURNITURE.finish];

    expect(ids.some((id) => id.startsWith('b'))).toBe(true);
    expect(ids.some((id) => id.startsWith('a'))).toBe(true);
  });

  it('puts the start furniture at the start and the finish tower at the finish', () => {
    const structures = courseStructures();

    const start = structures.filter((s) => s.progress < 0.1);
    const finish = structures.filter((s) => s.progress > 0.9);

    expect(start.length).toBeGreaterThan(0);
    expect(finish.length).toBeGreaterThan(0);
    expect(finish.map((s) => s.id)).toContain('a06-finish-tower');
  });
});

describe('liveried landmarks', () => {
  it('names models that exist', () => {
    const missing = LIVERIED_LANDMARKS.map((l) => l.id).filter((id) => !assetExists(id));

    expect(missing).toEqual([]);
  });

  it('pins Barnes Railway Bridge to the Thames at Barnes', () => {
    const thames = [
      { lat: 51.4712, lng: -0.2501 },
      { lat: 51.4735, lng: -0.2456 },
      { lat: 51.4756, lng: -0.2411 },
    ];

    const found = landmarkStructures(thames);

    expect(found.map((s) => s.id)).toContain('l-barnes-railway-bridge');
  });

  it('places nothing on water the landmarks do not belong to', () => {
    const elsewhere = [
      { lat: -33.86, lng: 151.21 },
      { lat: -33.87, lng: 151.22 },
    ];

    expect(landmarkStructures(elsewhere)).toEqual([]);
  });
});

describe('crossingStructures', () => {
  it('turns a crossing into the Tier C model for its kind', () => {
    const crossings: Crossing[] = [{ progress: 0.4, kind: 'rail' }];

    expect(crossingStructures(crossings)).toEqual([
      { id: 'c04-bridge-rail-girder', progress: 0.4, kind: 'bridge' },
    ]);
  });

  it('handles a route with no bridges', () => {
    expect(crossingStructures([])).toEqual([]);
    expect(crossingStructures(undefined)).toEqual([]);
  });
});

describe('computeStructurePlacements', () => {
  it('puts a bridge on the rowed line and furniture off to the side', () => {
    const [bridge] = computeStructurePlacements(curve, [
      { id: 'c02-bridge-road-concrete', progress: 0.5, kind: 'bridge' },
    ]);
    const [furniture] = computeStructurePlacements(curve, [
      { id: 'a06-finish-tower', progress: 0.5, kind: 'furniture' },
    ]);

    const offCentre = (p: typeof bridge) => Math.hypot(p.position[0], p.position[2]);

    expect(bridge.id).toBe('c02-bridge-road-concrete');
    expect(Math.abs(offCentre(bridge) - offCentre(furniture))).toBeGreaterThan(0);
  });

  it('is deterministic, so a route dresses the same way twice', () => {
    const request = [{ id: 'a06-finish-tower', progress: 0.9, kind: 'furniture' as const }];

    expect(computeStructurePlacements(curve, request)).toEqual(
      computeStructurePlacements(curve, request),
    );
  });

  it('produces finite transforms', () => {
    const placements = computeStructurePlacements(curve, [
      { id: 'c01-bridge-arch-masonry', progress: 0, kind: 'bridge' },
      { id: 'l-fremont-bridge', progress: 1, kind: 'landmark' },
    ]);

    expect(placements).toHaveLength(2);
    for (const p of placements) {
      expect(p.position.every(Number.isFinite)).toBe(true);
      expect(Number.isFinite(p.rotationY)).toBe(true);
      expect(p.scale).toBeGreaterThan(0);
    }
  });

  it('places nothing without a curve', () => {
    expect(computeStructurePlacements(null, [{ id: 'a06-finish-tower', progress: 0, kind: 'furniture' }])).toEqual([]);
  });
});
