import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Coordinate } from '../lib/types/index';
import type { OverpassElement, SceneryProfile } from '../lib/services/routeEnrichmentService';
import type { MaskBounds } from '../lib/utils/osmWaterMask';
import { runRouteDetection } from '../lib/utils/routeDetection';
import type { DetectedSample } from '../lib/utils/shoreDetection';

/**
 * #493 FR18 / AC19 on real courses: the land each bank's scenery is read from.
 * The water fixtures keep only water; the land-use areas beside each course are
 * in fixtures/osm/land/, recorded by scripts/record-osm-fixtures.ts --land and
 * trimmed to the areas some bank probe stands in (same answer, a fraction of
 * the size).
 */
interface WaterFixture {
  route: Coordinate[];
  bounds: MaskBounds;
  elements: OverpassElement[];
}

const DIR = join(process.cwd(), 'src/__tests__/fixtures/osm');
const read = <T,>(path: string) => JSON.parse(readFileSync(join(DIR, path), 'utf8')) as T;

const detect = (id: number) => {
  const water = read<WaterFixture>(`${id}.json`);
  const { elements: land } = read<{ elements: OverpassElement[] }>(`land/${id}.json`);
  const { samples } = runRouteDetection({
    coordinates: water.route,
    elements: [...water.elements, ...land],
    coastlineBounds: water.bounds,
  });
  return samples.filter((sample) => sample.kind === 'water');
};

const share = (samples: DetectedSample[], side: 'leftLand' | 'rightLand') =>
  samples.filter((sample) => sample[side]).length / samples.length;

const commonest = (samples: DetectedSample[], side: 'leftLand' | 'rightLand') => {
  const counts = new Map<SceneryProfile, number>();
  for (const sample of samples) {
    const land = sample[side];
    if (land) counts.set(land, (counts.get(land) ?? 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
};

describe('#493 FR18 bank land on the OSM reference courses', () => {
  // The share of on-water samples whose bank has mapped land 25 m past its shore,
  // as first recorded (10-18), per course and side. The rest keep the shared
  // profile. Low where the far side is open water or unmapped: 1 runs down the
  // middle of a lake, 179's estuary and 257's Detroit River are wide, 175 is at
  // sea, and 237 crosses open lake between the Montlake Cut's ends.
  const KNOWN_FLOOR: Record<number, [left: number, right: number]> = {
    1: [0.23, 0.11],
    61: [0.93, 0.92],
    153: [0.96, 0.97],
    175: [0, 0],
    179: [0.35, 0.38],
    237: [0.2, 0.29],
    257: [0.08, 0.01],
    277: [0.57, 0.57],
  };

  it.each(Object.entries(KNOWN_FLOOR).map(([id, [left, right]]) => [Number(id), left, right] as const))(
    'course %i finds land beyond at least %f of its left bank and %f of its right',
    (id, left, right) => {
      const samples = detect(id);
      expect(share(samples, 'leftLand')).toBeGreaterThanOrEqual(left);
      expect(share(samples, 'rightLand')).toBeGreaterThanOrEqual(right);
    },
  );

  it.each([61, 153])('course %i on the Charles has parkland along both banks', (id) => {
    const samples = detect(id);
    expect(commonest(samples, 'leftLand')).toBe('farmland');
    expect(commonest(samples, 'rightLand')).toBe('farmland');
  });

  it('gives the two banks of a course different land somewhere', () => {
    const samples = detect(179);
    expect(samples.some((sample) => sample.leftLand && sample.rightLand && sample.leftLand !== sample.rightLand)).toBe(true);
  });
});
