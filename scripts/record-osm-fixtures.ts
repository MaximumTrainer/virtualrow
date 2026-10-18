// Records the OSM reference fixtures for #493 (FR21).
//
//   npx vite-node scripts/record-osm-fixtures.ts [courseId ...]
//
// For each rownative course fixture: resolve its route the way an import does,
// send the exact Overpass query enrichment sends, and keep the elements the
// water/land mask and classification read. Writes
// src/__tests__/fixtures/osm/<id>.json. Needs network access to overpass-api.de.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { resolveCourseGeometry, type RownativeCourseGeometryInput } from '../src/services/rownativeGeometry';
import { OVERPASS_API_URL, buildOverpassQuery, type OverpassElement } from '../src/services/routeEnrichmentService';
import { isLandInWaterArea, isWaterArea } from '../src/utils/osmWaterMask';
import { parseTrackFile } from '../src/utils/trackParsers';

const ROWNATIVE = join(process.cwd(), 'src/__tests__/fixtures/rownative');
const OUT = join(process.cwd(), 'src/__tests__/fixtures/osm');
const COURSES = [1, 61, 153, 175, 179, 237, 257, 277];

const keep = (element: OverpassElement) => {
  const tags = element.tags ?? {};
  return isWaterArea(tags) || isLandInWaterArea(tags) || tags.waterway !== undefined || tags.natural === 'coastline';
};

const routeFor = async (id: number) => {
  const course = JSON.parse(readFileSync(join(ROWNATIVE, `${id}.json`), 'utf8')) as RownativeCourseGeometryInput & { name?: string };
  // 179's gates sit mid-estuary; the shipped Clyde track is its supported route (#194 R-8).
  const attachedTrack = id === 179
    ? parseTrackFile('179.gpx', readFileSync(join(ROWNATIVE, '179.gpx'), 'utf8')).coordinates
    : undefined;
  const resolved = await resolveCourseGeometry(course, { attachedTrack });
  return { name: course.name ?? `course ${id}`, source: resolved.source, coordinates: resolved.coordinates };
};

const fetchElements = async (query: string): Promise<OverpassElement[]> => {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const response = await fetch(OVERPASS_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
        'User-Agent': 'virtualrow-fixture-recorder (github.com/MaximumTrainer/virtualrow)',
      },
      body: `data=${encodeURIComponent(query)}`,
    });
    if (response.ok) return ((await response.json()) as { elements?: OverpassElement[] }).elements ?? [];
    console.warn(`  Overpass HTTP ${response.status}, attempt ${attempt}`);
    await new Promise((resolve) => setTimeout(resolve, attempt * 15_000));
  }
  throw new Error('Overpass failed three times');
};

const ids = process.argv.slice(2).map(Number).filter(Number.isFinite);
mkdirSync(OUT, { recursive: true });

for (const id of ids.length > 0 ? ids : COURSES) {
  const route = await routeFor(id);
  const query = buildOverpassQuery(route.coordinates);
  const all = await fetchElements(query);
  const elements = all.filter(keep);
  writeFileSync(
    join(OUT, `${id}.json`),
    `${JSON.stringify({ courseId: id, name: route.name, routeSource: route.source, recordedAt: new Date().toISOString(), route: route.coordinates, totalElements: all.length, elements })}\n`,
  );
  console.log(`${id} ${route.name}: kept ${elements.length} of ${all.length} elements`);
  // Overpass usage policy: be gentle between requests.
  await new Promise((resolve) => setTimeout(resolve, 5_000));
}
