// Records the OSM reference fixtures for #493 (FR21).
//
//   npx vite-node scripts/record-osm-fixtures.ts [--force] [--land | --trim] [courseId ...]
//
// Courses already recorded are skipped unless --force is given.
//
// --land records the land-use areas the per-bank scenery reads (FR18) for the
// courses already recorded, from the same query on the same stored route, into
// src/__tests__/fixtures/osm/land/<id>.json. The water fixtures stay as they are.
// Only the areas that stand beyond a bank somewhere on the route are kept (the
// winner at each of detection's land probes), so the answer is the same as
// with the whole response at a fraction of its size. --trim re-applies that to
// land fixtures already on disk, without the network.
//
// For each rownative course fixture: resolve its route the way an import does,
// send the exact Overpass query enrichment sends, and keep the elements the
// water/land mask and classification read. Writes
// src/__tests__/fixtures/osm/<id>.json. Needs network access to overpass-api.de.

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Coordinate } from '../src/types/index';
import { JSDOM } from 'jsdom';
import { classifyPolygons, resolveCourseGeometry, type RownativeCourseGeometryInput } from '../src/services/rownativeGeometry';
import { OVERPASS_API_URL, SHORE_QUERY_MARGIN_METERS, buildBoundingBox, buildOverpassQuery, type OverpassElement } from '../src/services/routeEnrichmentService';
import { buildLandAreas, landAt } from '../src/utils/bankLand';
import { buildWaterMask, isLandInWaterArea, isWaterArea, type MaskBounds } from '../src/utils/osmWaterMask';
import { detectRoute } from '../src/utils/shoreDetection';
import { mapOsmTagsToSceneryProfile } from '../src/utils/sceneryFromTags';
import { parseTrackFile } from '../src/utils/trackParsers';

// The track parsers read GPX with the browser's DOMParser.
globalThis.DOMParser ??= new JSDOM().window.DOMParser;

const ROWNATIVE = join(process.cwd(), 'src/__tests__/fixtures/rownative');
const OUT = join(process.cwd(), 'src/__tests__/fixtures/osm');
const COURSES = [1, 61, 153, 175, 179, 237, 257, 277];

const keep = (element: OverpassElement) => {
  const tags = element.tags ?? {};
  return isWaterArea(tags) || isLandInWaterArea(tags) || tags.waterway !== undefined || tags.natural === 'coastline';
};

// 175 starts and finishes on one gate, so it needs a track. Stonehaven harbour opens
// east onto the North Sea: the same 2.5 km out-and-back due east the geometry test
// attaches makes it the open-sea / coastline reference.
const stonehavenTrack = (course: RownativeCourseGeometryInput) => {
  const [start, finish] = classifyPolygons(course).gates.map((gate) => gate.center);
  const out = Array.from({ length: 26 }, (_, i) => ({
    lat: start.lat,
    lng: start.lng + (i * 2500) / 26 / (111_320 * Math.cos((start.lat * Math.PI) / 180)),
  }));
  return [...out, ...out.slice(0, -1).reverse().map((p) => ({ ...p })), finish];
};

const routeFor = async (id: number) => {
  const course = JSON.parse(readFileSync(join(ROWNATIVE, `${id}.json`), 'utf8')) as RownativeCourseGeometryInput & { name?: string };
  // 179's gates sit mid-estuary; the shipped Clyde track is its supported route (#194 R-8).
  const attachedTrack = id === 179
    ? parseTrackFile('179.gpx', readFileSync(join(ROWNATIVE, '179.gpx'), 'utf8')).coordinates
    : id === 175 ? stonehavenTrack(course) : undefined;
  const resolved = await resolveCourseGeometry(course, { attachedTrack });
  return { name: course.name ?? `course ${id}`, source: resolved.source, coordinates: resolved.coordinates };
};

const fetchElements = async (query: string): Promise<OverpassElement[]> => {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const response = await fetch(OVERPASS_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
        'User-Agent': 'virtualrow-fixture-recorder (github.com/maximum-trainer/virtualrow)',
      },
      body: `data=${encodeURIComponent(query)}`,
    });
    if (response.ok) return ((await response.json()) as { elements?: OverpassElement[] }).elements ?? [];
    console.warn(`  Overpass HTTP ${response.status}, attempt ${attempt}`);
    await new Promise((resolve) => setTimeout(resolve, attempt * 15_000));
  }
  throw new Error('Overpass failed three times');
};

const args = process.argv.slice(2);
const force = args.includes('--force');
const land = args.includes('--land');
const trim = args.includes('--trim');
const ids = args.map(Number).filter(Number.isFinite);
mkdirSync(OUT, { recursive: true });

interface WaterFixture {
  route: Coordinate[];
  bounds: MaskBounds;
  elements: OverpassElement[];
}

// The land elements some bank probe lands in, smallest-first as landAt picks,
// without the node ids and bounds the detection never reads.
const trimLand = ({ route, bounds, elements: water }: WaterFixture, elements: OverpassElement[]) => {
  const areas = elements.map((element) => buildLandAreas([element]));
  const used = new Set<number>();
  detectRoute(route, buildWaterMask(water, { coastlineBounds: bounds }), {
    landAt: (point) => {
      let best = -1;
      let size = Infinity;
      areas.forEach((own, index) => {
        for (const area of own) {
          if (area.size < size && landAt([area], point) !== null) {
            best = index;
            size = area.size;
          }
        }
      });
      if (best >= 0) used.add(best);
      return null;
    },
  });
  return elements
    .filter((_, index) => used.has(index))
    .map(({ nodes: _nodes, bounds: _bounds, ...element }: OverpassElement & { nodes?: unknown; bounds?: unknown }) => element);
};

const trimRecordedLand = (id: number) => {
  const target = join(OUT, 'land', `${id}.json`);
  const recorded = JSON.parse(readFileSync(target, 'utf8')) as { elements: OverpassElement[] };
  const water = JSON.parse(readFileSync(join(OUT, `${id}.json`), 'utf8')) as WaterFixture;
  const elements = trimLand(water, recorded.elements);
  writeFileSync(target, `${JSON.stringify({ ...recorded, elements })}\n`);
  console.log(`${id} land: trimmed ${recorded.elements.length} to ${elements.length} elements`);
};

const recordLand = async (id: number) => {
  const target = join(OUT, 'land', `${id}.json`);
  if (!force && existsSync(target)) return console.log(`${id}: land already recorded`);
  const water = JSON.parse(readFileSync(join(OUT, `${id}.json`), 'utf8')) as WaterFixture;
  const all = await fetchElements(buildOverpassQuery(water.route));
  const elements = trimLand(water, all.filter((element) => mapOsmTagsToSceneryProfile(element.tags) !== 'fallback'));
  writeFileSync(target, `${JSON.stringify({ courseId: id, recordedAt: new Date().toISOString(), totalElements: all.length, elements })}\n`);
  console.log(`${id} land: kept ${elements.length} of ${all.length} elements`);
};

const failed: number[] = [];
if (land) mkdirSync(join(OUT, 'land'), { recursive: true });
for (const id of ids.length > 0 ? ids : COURSES) {
  if (trim) {
    trimRecordedLand(id);
    continue;
  }
  if (land) {
    try {
      await recordLand(id);
    } catch (error) {
      failed.push(id);
      console.error(`${id} land failed:`, error instanceof Error ? error.message : error);
    }
    await new Promise((resolve) => setTimeout(resolve, 5_000));
    continue;
  }
  if (!force && existsSync(join(OUT, `${id}.json`))) {
    console.log(`${id}: already recorded`);
    continue;
  }
  try {
    const route = await routeFor(id);
    const query = buildOverpassQuery(route.coordinates);
    const all = await fetchElements(query);
    const elements = all.filter(keep);
    writeFileSync(
      join(OUT, `${id}.json`),
      `${JSON.stringify({ courseId: id, name: route.name, routeSource: route.source, recordedAt: new Date().toISOString(), route: route.coordinates, bounds: buildBoundingBox(route.coordinates, SHORE_QUERY_MARGIN_METERS), totalElements: all.length, elements })}\n`,
    );
    console.log(`${id} ${route.name}: kept ${elements.length} of ${all.length} elements`);
  } catch (error) {
    // Keep going: one bad course shouldn't cost the others their recording.
    failed.push(id);
    console.error(`${id} failed:`, error instanceof Error ? error.message : error);
  }
  // Overpass usage policy: be gentle between requests.
  await new Promise((resolve) => setTimeout(resolve, 5_000));
}
if (failed.length > 0) {
  console.error(`Not recorded: ${failed.join(', ')}`);
  process.exitCode = 1;
}
