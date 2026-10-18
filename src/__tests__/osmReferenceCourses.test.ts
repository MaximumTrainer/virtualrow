import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Coordinate } from '../types/index';
import type { OverpassElement } from '../services/routeEnrichmentService';
import { buildWaterMask, pointInPolygon, type MaskBounds } from '../utils/osmWaterMask';
import { detectRoute } from '../utils/shoreDetection';

/**
 * #493 FR21 / AC22: detection run on real courses. Each fixture is the Overpass
 * response enrichment's own query returned for a rownative course, recorded by
 * scripts/record-osm-fixtures.ts (see the file's `recordedAt`).
 */
interface OsmFixture {
  courseId: number;
  name: string;
  routeSource: string;
  recordedAt: string;
  route: Coordinate[];
  bounds: MaskBounds;
  elements: OverpassElement[];
}

const DIR = join(process.cwd(), 'src/__tests__/fixtures/osm');
const fixtures: OsmFixture[] = readdirSync(DIR)
  .filter((file) => file.endsWith('.json'))
  .map((file) => JSON.parse(readFileSync(join(DIR, file), 'utf8')) as OsmFixture);

const detect = (fixture: OsmFixture) =>
  detectRoute(fixture.route, buildWaterMask(fixture.elements, { coastlineBounds: fixture.bounds }));

const byId = (id: number) => {
  const fixture = fixtures.find((candidate) => candidate.courseId === id);
  if (!fixture) throw new Error(`no OSM fixture for course ${id}`);
  return fixture;
};

describe('#493 OSM reference courses (FR21)', () => {
  it('has the recorded courses', () => {
    expect(fixtures.map((fixture) => fixture.courseId).sort((a, b) => a - b)).toEqual(
      [1, 61, 153, 175, 179, 237, 257, 277],
    );
  });

  it.each(fixtures.map((fixture) => [fixture.courseId, fixture] as const))(
    'course %i has water mapped along its whole length',
    (_id, fixture) => {
      expect(detect(fixture).summary.unknown).toBe(0);
    },
  );

  // NFR8's on-water share, per course, as first recorded (pending Dan's call on the
  // rough routes). Where a share is below 1 the route line itself leaves the mapped
  // water: course 1 is two gates joined straight down a bending lake, 237 cuts the
  // Montlake Cut's corners, 257 crosses the tip of Fighting Island, 277's 16 points
  // miss the canal's bends, and 175's sea track passes the harbour mouth's rocks.
  const ON_WATER_FLOOR: Record<number, number> = {
    1: 0.69,
    61: 1,
    153: 1,
    175: 0.94,
    179: 1,
    237: 0.86,
    257: 0.88,
    277: 0.74,
  };

  it.each(Object.entries(ON_WATER_FLOOR).map(([id, floor]) => [Number(id), floor] as const))(
    'course %i keeps at least %f of its samples on water (NFR8)',
    (id, floor) => {
      const { summary } = detect(byId(id));
      expect(summary.water / (summary.water + summary.land + summary.unknown)).toBeGreaterThanOrEqual(floor);
    },
  );

  it.each([61, 153])('course %i on the Charles is on water at every sample', (id) => {
    const { summary } = detect(byId(id));
    expect(summary.land).toBe(0);
    expect(summary.water).toBeGreaterThan(0);
  });

  it('course 179 down the Clyde is on water at every sample, river then firth (FR19)', () => {
    const { samples, summary } = detect(byId(179));
    expect(summary.land).toBe(0);
    const features = new Set(samples.map((sample) => sample.featureId));
    // The tidal river is mapped as a water area; the firth beyond has only the coastline.
    expect(features).toEqual(new Set(['relation/2266953', 'coastline/sea0']));
  });

  it('course 175 off Stonehaven finds the sea from the coastline alone (FR19, AC20)', () => {
    const { samples } = detect(byId(175));
    const water = samples.filter((sample) => sample.kind === 'water');
    expect(water.length).toBeGreaterThan(0);
    expect(new Set(water.map((sample) => sample.featureId))).toEqual(new Set(['coastline/sea0']));
    // The out-and-back passes the harbour mouth's mapped rocks; nothing else counts as land.
    const fixture = byId(175);
    const mask = buildWaterMask(fixture.elements, { coastlineBounds: fixture.bounds });
    for (const sample of samples.filter((candidate) => candidate.kind === 'land')) {
      const island = mask.land.find((feature) =>
        feature.polygons.some((polygon) => pointInPolygon(sample.coordinate, polygon)),
      );
      expect(island?.tags.natural).toBe('bare_rock');
    }
  });

  // NFR9 asks for 200 ms; alone, the slowest course (257) takes ~90 ms. Inside the
  // parallel unit suite the same run measures 3-4x that, so this ceiling guards the
  // order of magnitude (before the shoreline grid it was 1.1 s alone) without
  // failing on a busy runner.
  it('builds the mask and walks every course well inside a second (NFR9)', () => {
    const slowest = Math.max(
      ...fixtures.map((fixture) => {
        // Best of three, so one GC pause on a shared runner doesn't fail the build.
        const times = [0, 1, 2].map(() => {
          const start = performance.now();
          detect(fixture);
          return performance.now() - start;
        });
        return Math.min(...times);
      }),
    );
    expect(slowest).toBeLessThan(600);
  });
});
