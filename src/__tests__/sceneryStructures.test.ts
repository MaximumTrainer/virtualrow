import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import * as THREE from 'three';
import {
  routeStructures,
  COURSE_FURNITURE,
  LIVERIED_LANDMARKS,
  courseStructures,
  landmarkStructures,
  crossingStructures,
  computeStructurePlacements,
} from '../components/rower3d/sceneryStructures';
import type { Crossing } from '../utils/bridgeCrossings';
import { buildTerrainProfile, type RouteEnrichmentData } from '../services/routeEnrichmentService';
import {
  SCENERY_WATER_MARGIN_METRES,
  waterHalfWidthAt,
} from '../components/rower3d/sceneryClearance';

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


describe('structures that span the water (review of #232)', () => {
  // Every Tier L landmark is a bridge, and each is authored the way the Tier C
  // bridges are: the span runs along the model's X. They were given the
  // "everything else faces the water" quarter turn, which laid Ponte Isabella
  // along the rowed line instead of across it.
  it('orients a liveried landmark across the water, like the bridge it is', () => {
    // Routed through landmarkStructures, because that is what decides the kind:
    // Ponte Isabella is authored like the Tier C arch (span along X), so it has
    // to be laid across the rowed line, not turned a quarter along it.
    const route = [
      { lat: 45.0447, lng: 7.6858 },
      { lat: 45.0457, lng: 7.6868 },
    ];
    const requests = landmarkStructures(route);
    const isabella = requests.find((r) => r.id === 'l-ponte-isabella');
    expect(isabella).toBeDefined();

    const [landmark] = computeStructurePlacements(curve, [{ ...isabella!, progress: 0.5 }]);
    const [bridge] = computeStructurePlacements(curve, [
      { id: 'c01-bridge-arch-masonry', progress: 0.5, kind: 'bridge' },
    ]);

    expect(landmark.rotationY).toBeCloseTo(bridge.rotationY, 6);
  });

  it('stands a non-spanning hero on the bank, facing the water', () => {
    // The 'landmark' kind now means exactly this, so a lighthouse added to the
    // table later does not inherit a bridge's place on the rowed line.
    const [hero] = computeStructurePlacements(curve, [
      { id: 'l-ponte-isabella', progress: 0.5, kind: 'landmark' },
    ]);
    const [bridge] = computeStructurePlacements(curve, [
      { id: 'c01-bridge-arch-masonry', progress: 0.5, kind: 'bridge' },
    ]);

    expect(Math.abs(hero.rotationY - bridge.rotationY)).toBeCloseTo(Math.PI / 2, 6);
    expect(Math.hypot(hero.position[0] - bridge.position[0], hero.position[2] - bridge.position[2]))
      .toBeGreaterThan(1);
  });

  it('still turns bank furniture to face the water', () => {
    const at = 0.5;
    const [bridge] = computeStructurePlacements(curve, [
      { id: 'c01-bridge-arch-masonry', progress: at, kind: 'bridge' },
    ]);
    const [furniture] = computeStructurePlacements(curve, [
      { id: 'a06-finish-tower', progress: at, kind: 'furniture' },
    ]);

    expect(Math.abs(furniture.rotationY - bridge.rotationY)).toBeCloseTo(Math.PI / 2, 6);
  });

  it('asks for a spanning landmark as the bridge it is', () => {
    // Whether a hero spans the water is a property of the structure, not
    // something the renderer should infer from the tier it came from.
    const route = [
      { lat: 51.4739, lng: -0.2463 },
      { lat: 51.4749, lng: -0.2453 },
    ];

    const [barnes] = landmarkStructures(route);

    expect(LIVERIED_LANDMARKS.every((l) => typeof l.spansWater === 'boolean')).toBe(true);
    expect(barnes.kind).toBe('bridge');
  });
});

describe('structures sit on the ground (review of #232)', () => {
  // Scatter in the same [0,0,0] group is lifted by getTerrainReliefForProgress;
  // structures were pinned to y = 0, so bank furniture was buried or floating
  // on any route with relief.
  const hilly = buildTerrainProfile([0, 12, 30, 18, 4]);

  it('lifts bank furniture onto the terrain', () => {
    const [flat] = computeStructurePlacements(curve, [
      { id: 'a06-finish-tower', progress: 0.5, kind: 'furniture' },
    ]);
    const [lifted] = computeStructurePlacements(
      curve,
      [{ id: 'a06-finish-tower', progress: 0.5, kind: 'furniture' }],
      hilly,
    );

    expect(flat.position[1]).toBe(0);
    expect(lifted.position[1]).toBeGreaterThan(0);
  });

  it('leaves structures on flat water at zero', () => {
    const [p] = computeStructurePlacements(
      curve,
      [{ id: 'a06-finish-tower', progress: 0.5, kind: 'furniture' }],
      buildTerrainProfile([]),
    );

    expect(p.position[1]).toBe(0);
  });

  it('keeps a bridge on the water line, whatever the banks do', () => {
    // A bridge deck is placed relative to the water it spans, not the hillside.
    const [p] = computeStructurePlacements(
      curve,
      [{ id: 'c01-bridge-arch-masonry', progress: 0.5, kind: 'bridge' }],
      hilly,
    );

    expect(p.position[1]).toBe(0);
  });
});


describe('routeStructures — what a route actually asks for (review of #232)', () => {
  const coordinates = [
    { lat: 51.4739, lng: -0.2463 },
    { lat: 51.4749, lng: -0.2453 },
  ];

  it('places structures once per route, on one bank only', () => {
    const left = routeStructures({ side: 'left', hasCurve: true, coordinates });
    const right = routeStructures({ side: 'right', hasCurve: true, coordinates });

    expect(left.length).toBeGreaterThan(0);
    expect(right).toEqual([]);
  });

  it('asks for nothing when there is no curve to place them on', () => {
    // computeStructurePlacements returns [] without a curve, but the models
    // were still added to the useGLTF path list, so a straight-mode route
    // downloaded and suspended on 8+ GLBs — two of them Tier B — to render
    // none of them.
    expect(routeStructures({ side: 'left', hasCurve: false, coordinates })).toEqual([]);
  });

  it('still carries the course furniture and any landmark the route earns', () => {
    const ids = routeStructures({ side: 'left', hasCurve: true, coordinates }).map((s) => s.id);

    expect(ids).toContain('a06-finish-tower');
    expect(ids).toContain('l-barnes-railway-bridge');
  });
});

describe('structures stand clear of the water (#379)', () => {
  // A straight route along +z, so the distance across the water is |x|.
  const straight = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, -300),
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, 0, 300),
  ]);

  const river = (widthMeters: number): RouteEnrichmentData =>
    ({
      routeId: 'river',
      elevations: [],
      segmentProfiles: [0, 1, 2].map((index) => ({
        index,
        startMeters: index * 50,
        endMeters: (index + 1) * 50,
        sceneryProfile: 'fallback',
        treeDensity: 0.5,
        vegetationDensity: 0.5,
        buildingDensity: 0.2,
        objectScale: 1,
        waterWidthMeters: widthMeters,
        dragMultiplier: 1,
        bearing: 0,
        bearingDelta: 0,
      })),
      waterBodyType: 'river',
      waterWidthMeters: widthMeters,
      waterColor: '#000',
      waveIntensity: 0.5,
      fetchedAt: 0,
      source: 'fallback',
    }) as RouteEnrichmentData;

  const across = (kind: 'bridge' | 'furniture' | 'landmark', e?: RouteEnrichmentData | null) => {
    const [p] = computeStructurePlacements(
      straight,
      [{ id: 'a06-finish-tower', progress: 0.5, kind }],
      null,
      e,
    );
    return { distance: Math.abs(p.position[0]), footing: p.footing };
  };

  it('stands a landmark on the bank of a 55 m river, past the shoreline margin', () => {
    const landmark = across('landmark', river(55));

    expect(landmark.distance).toBeGreaterThanOrEqual(27.5);
    expect(landmark.distance).toBeGreaterThanOrEqual(27.5 + SCENERY_WATER_MARGIN_METRES);
    expect(landmark.footing).toBe('bank');
  });

  it('stands course furniture on the bank of a 55 m river', () => {
    expect(across('furniture', river(55)).distance).toBeGreaterThanOrEqual(
      27.5 + SCENERY_WATER_MARGIN_METRES,
    );
  });

  it('keeps a bridge on the centreline, however wide the water', () => {
    for (const width of [7, 55, 120]) {
      const bridge = across('bridge', river(width));
      expect(bridge.distance).toBeCloseTo(0, 9);
      expect(bridge.footing).toBe('water');
    }
  });

  it('leaves furniture where it was on a stream narrow enough to allow it', () => {
    // 7 m of water: half of the 7.06 m floor plus the margin is still inside
    // the 7 m the furniture was authored at.
    expect(across('furniture', river(7)).distance).toBeCloseTo(7, 9);
  });

  it('reads the default channel for a route with no enrichment, as the water does', () => {
    expect(across('furniture', null).distance).toBeCloseTo(
      waterHalfWidthAt(null, 0.5) + SCENERY_WATER_MARGIN_METRES,
      9,
    );
  });
});
