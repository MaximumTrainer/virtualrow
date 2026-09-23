import { describe, it, expect, afterEach } from 'vitest';
import * as THREE from 'three';
import {
  FOLIAGE_BAND_DEPTH_METRES,
  FOLIAGE_BUILDING_CLEARANCE_METRES,
  FOLIAGE_SHAPE_SIZE,
  FOLIAGE_SLOT_METRES,
  batchFoliage,
  compactVisible,
  createFoliageGeometry,
  foliageStanding,
  isFoliageEnabled,
  layoutFoliage,
  type FoliageTree,
} from '../components/rower3d/foliagePlan';
import { foliageShapeFor } from '../components/rower3d/foliageTexture';
import { SCENE_CONFIG, type TreeSpeciesEntry } from '../components/rower3d/themeConfig';
import {
  SCENERY_WATER_MARGIN_METRES,
  landClearance,
  nearestBankOffset,
} from '../components/rower3d/sceneryClearance';
import type { SceneryTrack } from '../components/rower3d/sceneryTrack';
import type { RouteEnrichmentData, SceneryProfile } from '../services/routeEnrichmentService';

/**
 * Issue #333 — where the billboard trees stand.
 *
 * The cone trees were placed every 2 % of route *progress*, so how many a bank
 * got had nothing to do with how long it was: one slot per 135 m on the 6.7 km
 * demo, one tree per ~340 m of bank, and a hero shot of empty green. These are
 * placed in metres.
 */

const SPECIES = SCENE_CONFIG.trees.species;

const straight = (length: number) =>
  new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, -length / 2),
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, 0, length / 2),
  ]);

const water = (widthMeters: number, profile: SceneryProfile = 'fallback'): RouteEnrichmentData =>
  ({
    routeId: 'foliage',
    elevations: [],
    segmentProfiles: [0, 1, 2, 3].map((index) => ({
      index,
      startMeters: index * 50,
      endMeters: (index + 1) * 50,
      sceneryProfile: profile,
      treeDensity: 0.7,
      vegetationDensity: 0.4,
      buildingDensity: 0.3,
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

const onlyProfile = (profile: SceneryProfile): SceneryTrack => ({
  bands: [{ untilProgress: 1, profile, water: 'river', label: profile }],
});

const lay = (curve: THREE.Curve<THREE.Vector3>, enrichment: RouteEnrichmentData | null, extra = {}) =>
  layoutFoliage({ curve, enrichment, species: SPECIES, ...extra });

/** Mean gap along the route between consecutive trees on one bank, in metres. */
const meanSpacing = (trees: FoliageTree[], length: number, side: 'left' | 'right') => {
  const bank = trees.filter((t) => (side === 'left' ? t.position[0] < 0 : t.position[0] > 0));
  return length / bank.length;
};

describe('layoutFoliage', () => {
  it('lines both banks with a tree every 12 to 30 m', () => {
    const length = 2000;
    const trees = lay(straight(length), water(40));

    for (const side of ['left', 'right'] as const) {
      const spacing = meanSpacing(trees, length, side);
      expect(spacing, `${side} bank`).toBeGreaterThanOrEqual(12);
      expect(spacing, `${side} bank`).toBeLessThanOrEqual(30);
    }
  });

  it('places by the metre, so a route twice as long has twice the trees', () => {
    const short = lay(straight(1500), water(40)).length;
    const long = lay(straight(3000), water(40)).length;

    expect(long / short).toBeGreaterThan(1.8);
    expect(long / short).toBeLessThan(2.2);
  });

  it('samples a slot every FOLIAGE_SLOT_METRES and runs the whole route', () => {
    const trees = lay(straight(1000), water(40));
    const progress = trees.map((t) => t.progress);

    expect(Math.min(...progress)).toBeLessThan(FOLIAGE_SLOT_METRES * 3 / 1000);
    expect(Math.max(...progress)).toBeGreaterThan(1 - (FOLIAGE_SLOT_METRES * 3) / 1000);
    expect(trees.length).toBeLessThanOrEqual((2 * 1000) / FOLIAGE_SLOT_METRES);
  });

  it('stands every trunk clear of the water, however wide it is', () => {
    for (const width of [20, 55, 120]) {
      const trees = lay(straight(1200), water(width));
      const reading = landClearance(foliageStanding(trees), straight(1200), water(width));

      expect(reading.count).toBe(trees.length);
      expect(reading.nearestM).toBeGreaterThanOrEqual(SCENERY_WATER_MARGIN_METRES - 1e-6);
    }
  });

  it('keeps clear of the water on a bend as well', () => {
    const bend = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0, -600),
      new THREE.Vector3(200, 0, 0),
      new THREE.Vector3(0, 0, 600),
    ]);
    const reading = landClearance(foliageStanding(lay(bend, water(120))), bend, water(120));

    expect(reading.nearestM).toBeGreaterThanOrEqual(SCENERY_WATER_MARGIN_METRES - 1e-6);
  });

  it('crowds the bank rather than spreading evenly across the band behind it', () => {
    const trees = lay(straight(3000), water(40));
    const floor = nearestBankOffset(20);
    const behind = trees.map((t) => Math.abs(t.position[0]) - floor);

    expect(Math.min(...behind)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...behind)).toBeLessThanOrEqual(FOLIAGE_BAND_DEPTH_METRES + 1);
    // Most of the planting is in the front half of the band: a tree-lined bank.
    const front = behind.filter((d) => d < FOLIAGE_BAND_DEPTH_METRES / 2).length;
    expect(front / behind.length).toBeGreaterThan(0.6);
  });

  it('plants a forest denser than a town centre', () => {
    const forest = lay(straight(2000), water(40), { track: onlyProfile('forest') }).length;
    const town = lay(straight(2000), water(40), { track: onlyProfile('commercial') }).length;

    expect(forest).toBeGreaterThan(town * 1.5);
  });

  it('plants what the profile grows, in a colour the scene config gives it', () => {
    const species = (profile: SceneryProfile) =>
      new Set(lay(straight(2000), water(40), { track: onlyProfile(profile) }).map((t) => SPECIES[t.species].type));

    // Forest allows pine, oak and willow, all three of which the config colours.
    expect([...species('forest')].sort()).toEqual(['oak', 'pine', 'willow']);
    // Farmland grows no pines.
    expect(species('farmland').has('pine')).toBe(false);
    // A town centre grows only ornamentals, which the config has no colour
    // for: they are drawn as the configured species of the same shape.
    expect([...species('commercial')]).toEqual(['oak']);
  });

  it('falls back to every configured species when nothing matches the profile', () => {
    const palms: TreeSpeciesEntry[] = [{ type: 'palm', color: '#123', trunkColor: '#456' }];
    const trees = layoutFoliage({
      curve: straight(800),
      enrichment: water(40),
      species: palms,
      track: onlyProfile('forest'),
    });
    expect(trees.length).toBeGreaterThan(0);
    expect(new Set(trees.map((t) => t.species))).toEqual(new Set([0]));
  });

  it('grows each shape to a believable height', () => {
    for (const tree of lay(straight(2000), water(40), { track: onlyProfile('forest') })) {
      const shape = foliageShapeFor(SPECIES[tree.species].type);
      expect(tree.height).toBeGreaterThanOrEqual(FOLIAGE_SHAPE_SIZE[shape].height * 0.6);
      expect(tree.height).toBeLessThanOrEqual(FOLIAGE_SHAPE_SIZE[shape].height * 1.45);
    }
  });

  it('keeps out of the houses', () => {
    const avoid = [{ x: -30, z: 0 }, { x: 35, z: 200 }];
    const trees = lay(straight(1200), water(40), { avoid });

    for (const house of avoid) {
      const nearest = Math.min(
        ...trees.map((t) => Math.hypot(t.position[0] - house.x, t.position[2] - house.z)),
      );
      expect(nearest).toBeGreaterThanOrEqual(FOLIAGE_BUILDING_CLEARANCE_METRES);
    }
  });

  it('is deterministic, so a route looks the same on every visit', () => {
    expect(lay(straight(1200), water(40))).toEqual(lay(straight(1200), water(40)));
  });

  it('plants the bundled channel width when there is no enrichment', () => {
    expect(lay(straight(1200), null).length).toBeGreaterThan(50);
  });

  it('places nothing without a curve', () => {
    expect(layoutFoliage({ curve: null, species: SPECIES })).toEqual([]);
  });
});

describe('batchFoliage', () => {
  const trees: FoliageTree[] = [
    { position: [1, 2, 3], progress: 0.1, species: 0, height: 10, yaw: 0 },
    { position: [4, 5, 6], progress: 0.2, species: 1, height: 12, yaw: Math.PI / 2 },
    { position: [7, 8, 9], progress: 0.3, species: 0, height: 14, yaw: 0 },
  ];

  it('gives each species one batch of matrices, one per tree', () => {
    const batches = batchFoliage(trees, 3);

    expect(batches.map((b) => b.count)).toEqual([2, 1, 0]);
    expect(batches[0].matrices.length).toBe(2 * 16);
    expect(batches[0].centres).toEqual(new Float32Array([1, 3, 7, 9]));
  });

  it('stands each tree where it was placed, as tall as it was grown', () => {
    const [first] = batchFoliage(trees, 2);
    const matrix = new THREE.Matrix4().fromArray(first.matrices, 16);
    const position = new THREE.Vector3();
    const scale = new THREE.Vector3();
    matrix.decompose(position, new THREE.Quaternion(), scale);

    expect(position.toArray()).toEqual([7, 8, 9]);
    expect(scale.x).toBeCloseTo(14, 5);
    expect(scale.y).toBeCloseTo(14, 5);
  });
});

describe('compactVisible', () => {
  const trees: FoliageTree[] = [0, 100, 200, 300].map((z, i) => ({
    position: [0, 0, z],
    progress: i / 4,
    species: 0,
    height: 10 + i,
    yaw: 0,
  }));
  const [batch] = batchFoliage(trees, 1);

  it('packs the trees within range to the front, in order, and counts them', () => {
    const target = new Float32Array(batch.matrices.length);
    const count = compactVisible(batch, new THREE.Vector3(0, 0, 250), 160, target);

    expect(count).toBe(3);
    expect(Array.from(target.subarray(0, 48))).toEqual(Array.from(batch.matrices.subarray(16, 64)));
  });

  it('draws nothing when the boat is far from every tree', () => {
    const target = new Float32Array(batch.matrices.length);
    expect(compactVisible(batch, new THREE.Vector3(5000, 0, 0), 100, target)).toBe(0);
  });
});

describe('createFoliageGeometry', () => {
  const geometry = createFoliageGeometry(0.8);
  const positions = geometry.getAttribute('position');

  it('is two quads crossed at right angles: eight corners, four triangles, each wound both ways', () => {
    expect(positions.count).toBe(8);
    const index = Array.from(geometry.getIndex()!.array);
    expect(index.length).toBe(24);
    // Every triangle has its mirror, so the quad is seen from both sides by a
    // front-face material, and its normal is never flipped into the ground.
    const key = (tri: number[]) => [...tri].sort().join(',');
    const winding = (tri: number[]) => {
      const start = tri.indexOf(Math.min(...tri));
      return [0, 1, 2].map((k) => tri[(start + k) % 3]).join(',');
    };
    const triangles = Array.from({ length: 8 }, (_, i) => index.slice(i * 3, i * 3 + 3));
    for (const tri of triangles.slice(0, 4)) {
      const mirror = triangles.slice(4).find((other) => key(other) === key(tri));
      expect(mirror, `triangle ${tri} has no back face`).toBeDefined();
      expect(winding(mirror!)).not.toBe(winding(tri));
    }
    const xs = Array.from({ length: 8 }, (_, i) => positions.getX(i));
    const zs = Array.from({ length: 8 }, (_, i) => positions.getZ(i));
    // One quad in x, one in z, each `aspect` wide about the trunk.
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(0.8, 6);
    expect(Math.max(...zs) - Math.min(...zs)).toBeCloseTo(0.8, 6);
  });

  it('stands on the ground and is one unit tall, so the instance scale is its height', () => {
    const ys = Array.from({ length: 8 }, (_, i) => positions.getY(i));
    expect(Math.min(...ys)).toBe(0);
    expect(Math.max(...ys)).toBe(1);
  });

  it('maps the bottom of the texture to the ground, which is where the sway is zero', () => {
    const uv = geometry.getAttribute('uv');
    for (let i = 0; i < 8; i += 1) expect(uv.getY(i)).toBe(positions.getY(i));
  });

  it('lights the crown as a rounded mass rather than as two flat cards', () => {
    const normals = geometry.getAttribute('normal');
    for (let i = 0; i < 8; i += 1) {
      const n = new THREE.Vector3(normals.getX(i), normals.getY(i), normals.getZ(i));
      expect(n.length()).toBeCloseTo(1, 5);
      // Up and out from the trunk: never facing the ground.
      expect(n.y).toBeGreaterThan(0);
    }
  });
});

describe('isFoliageEnabled', () => {
  afterEach(() => {
    delete window.__VIRTUALROW_FOLIAGE;
  });

  it('is on unless a spec turns it off to measure what it costs', () => {
    expect(isFoliageEnabled()).toBe(true);
    window.__VIRTUALROW_FOLIAGE = false;
    expect(isFoliageEnabled()).toBe(false);
  });
});
