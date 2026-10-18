import { describe, expect, it } from 'vitest';
import type { OverpassElement } from '../services/routeEnrichmentService';
import type { Coordinate } from '../types/index';
import { buildWaterMask } from '../utils/osmWaterMask';
import { detectRoute, localProjection } from '../utils/shoreDetection';

// Synthetic water laid out in metres east (x) and north (y) of an origin, so
// expected distances can be read straight off the fixture.
const ORIGIN: Coordinate = { lat: 52, lng: 0 };
const { toCoordinate } = localProjection(ORIGIN);
const at = (x: number, y: number) => toCoordinate({ x, y });

const ringOf = (points: Array<[number, number]>) => {
  const ring = points.map(([x, y]) => at(x, y));
  return [...ring, ring[0]].map(({ lat, lng }) => ({ lat, lon: lng }));
};

const way = (id: number, points: Array<[number, number]>, tags: Record<string, string>): OverpassElement => ({
  type: 'way',
  id,
  geometry: ringOf(points),
  tags,
});

// A channel 60 m wide (x from -15 to 45) and 1 km long, running north.
const channel = way(1, [[-15, -100], [45, -100], [45, 1100], [-15, 1100]], { natural: 'water', water: 'river' });
const routeUpChannel = [at(0, 0), at(0, 1000)];

describe('shoreDetection — local projection', () => {
  it('round-trips a coordinate through metres', () => {
    const { toMetres } = localProjection(ORIGIN);
    const point = { lat: 52.001, lng: 0.002 };
    const back = toCoordinate(toMetres(point));
    expect(back.lat).toBeCloseTo(point.lat, 9);
    expect(back.lng).toBeCloseTo(point.lng, 9);
  });

  it('measures 1 km north as 1000 m', () => {
    expect(localProjection(ORIGIN).toMetres(at(0, 1000)).y).toBeCloseTo(1000, 6);
  });
});

describe('shoreDetection — sampling the route (D22)', () => {
  it('samples every 50 m, end inclusive', () => {
    const detection = detectRoute(routeUpChannel, buildWaterMask([channel]));
    expect(detection.samples.map((sample) => Math.round(sample.distanceMeters))).toEqual(
      Array.from({ length: 21 }, (_, index) => index * 50),
    );
  });
});

describe('shoreDetection — denser samples near islands and narrows (D22 c)', () => {
  const spacingAround = (detection: ReturnType<typeof detectRoute>, from: number, to: number) =>
    detection.samples
      .map((sample) => Math.round(sample.distanceMeters))
      .filter((distance) => distance >= from && distance <= to);

  it('samples every 10 m within reach of an island, and every 50 m elsewhere', () => {
    const island = way(6, [[10, 400], [30, 400], [30, 600], [10, 600]], { place: 'islet' });
    const detection = detectRoute(routeUpChannel, buildWaterMask([channel, island]));
    expect(spacingAround(detection, 450, 500)).toEqual([450, 460, 470, 480, 490, 500]);
    expect(spacingAround(detection, 0, 100)).toEqual([0, 50, 100]);
  });

  it('samples every 10 m through a narrows', () => {
    // The channel pinches to 20 m wide between 700 m and 800 m.
    const pinched = way(7, [
      [-15, -100], [45, -100], [45, 700], [10, 700], [10, 800], [45, 800], [45, 1100], [-15, 1100],
    ], { natural: 'water', water: 'river' });
    const detection = detectRoute(routeUpChannel, buildWaterMask([pinched]));
    expect(spacingAround(detection, 700, 750)).toEqual([700, 710, 720, 730, 740, 750]);
    expect(spacingAround(detection, 200, 300)).toEqual([200, 250, 300]);
  });
});

describe('shoreDetection — shore distance each side, off-centre (FR16, G3)', () => {
  const detection = detectRoute(routeUpChannel, buildWaterMask([channel]));

  it('measures the near bank on the left and the far bank on the right', () => {
    for (const sample of detection.samples) {
      expect(sample.leftShoreMeters).toBeCloseTo(15, 0);
      expect(sample.rightShoreMeters).toBeCloseTo(45, 0);
    }
  });

  it('marks every sample as on the channel', () => {
    expect(detection.samples.every((sample) => sample.kind === 'water' && sample.featureId === 'way/1')).toBe(true);
    expect(detection.summary).toMatchObject({ water: 21, land: 0, unknown: 0 });
  });
});

describe('shoreDetection — open water (D20)', () => {
  it('reports no shore on a side where none is within the ray limit', () => {
    const lake = way(2, [[-15, -100], [5000, -100], [5000, 1100], [-15, 1100]], { natural: 'water' });
    const detection = detectRoute(routeUpChannel, buildWaterMask([lake]), { maxRayMeters: 500 });
    expect(detection.samples[5].leftShoreMeters).toBeCloseTo(15, 0);
    expect(detection.samples[5].rightShoreMeters).toBeNull();
  });
});

describe('shoreDetection — islands (FR17)', () => {
  // A 20 m island 10 m to the right of the route, between 400 m and 600 m.
  const island = way(3, [[10, 400], [30, 400], [30, 600], [10, 600]], { place: 'islet', name: 'Eyot' });
  const detection = detectRoute(routeUpChannel, buildWaterMask([channel, island]));

  it('stops the right-hand ray at the island where it lies beside the route', () => {
    const beside = detection.samples.find((sample) => sample.distanceMeters === 500)!;
    expect(beside.rightShoreMeters).toBeCloseTo(10, 0);
    const clear = detection.samples.find((sample) => sample.distanceMeters === 100)!;
    expect(clear.rightShoreMeters).toBeCloseTo(45, 0);
  });

  it('lists the islands within reach of the route, holes in the water included', () => {
    const lakeWithHole: OverpassElement = {
      type: 'relation',
      id: 4,
      tags: { type: 'multipolygon', natural: 'water' },
      members: [
        { type: 'way', ref: 40, role: 'outer', geometry: ringOf([[-15, -100], [45, -100], [45, 1100], [-15, 1100]]) },
        { type: 'way', ref: 41, role: 'inner', geometry: ringOf([[-12, 200], [-5, 200], [-5, 260], [-12, 260]]) },
      ],
    };
    const withBoth = detectRoute(routeUpChannel, buildWaterMask([lakeWithHole, island]));
    expect(withBoth.islands.map((found) => found.id)).toEqual(['relation/4#inner0', 'way/3']);
    expect(withBoth.islands.find((found) => found.id === 'way/3')?.name).toBe('Eyot');
  });
});

describe('shoreDetection — samples on land (D21)', () => {
  const narrow = way(5, [[-15, -100], [45, -100], [45, 1100], [-15, 1100]], { natural: 'water' });

  it('counts a sample a few metres over the bank as on the water it drifted from', () => {
    const drifting = [at(-25, 0), at(-25, 1000)];
    const detection = detectRoute(drifting, buildWaterMask([narrow]), { landToleranceMeters: 15 });
    expect(detection.summary.land).toBe(0);
    expect(detection.samples[0]).toMatchObject({ kind: 'water', featureId: 'way/5', driftMeters: expect.any(Number) });
    expect(detection.samples[0].driftMeters).toBeCloseTo(10, 0);
  });

  it('counts a sample past the tolerance as land, with no shore distances', () => {
    const ashore = [at(-60, 0), at(-60, 1000)];
    const detection = detectRoute(ashore, buildWaterMask([narrow]), { landToleranceMeters: 15 });
    expect(detection.summary.land).toBe(21);
    expect(detection.samples[0]).toMatchObject({ kind: 'land', leftShoreMeters: null, rightShoreMeters: null });
  });

  it('reports unknown everywhere when OSM mapped no water', () => {
    const detection = detectRoute(routeUpChannel, buildWaterMask([]));
    expect(detection.summary).toMatchObject({ water: 0, land: 0, unknown: 21 });
  });
});
