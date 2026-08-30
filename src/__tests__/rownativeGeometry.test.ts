import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { Coordinate } from '../types/index';
import {
  GATE_TOLERANCE_M,
  RownativeGeometryUnavailableError,
  classifyPolygons,
  fitCandidateToGates,
  resolveCourseGeometry,
  type RownativeCourseGeometryInput,
} from '../services/rownativeGeometry';
import { OsmWaterwayPathProvider } from '../services/osmWaterwayPathProvider';
import { RouteService } from '../services/routeService';
import { RownativeService } from '../services/rownativeService';
import { TrackAttachmentStore } from '../services/trackAttachmentStore';
import { createRouteCurve, distanceToProgress, getCurveDistances } from '../components/rower3d/curve';
import { distanceBetweenMeters, polylineLengthMeters } from '../utils/coordinateUtils';
import { routeTotalDistanceMeters } from '../utils/geoUtils';
import { projectPointOntoPolyline } from '../utils/polylineGeometry';
import { parseTrackFile } from '../utils/trackParsers';

/**
 * Offline fixtures copied verbatim from the rownative/courses mirror
 * (issue #194 R-15). Every number asserted below was measured against these
 * exact files, so a drift upstream cannot silently change what we claim.
 */
function fixture(name: string): string {
  return readFileSync(join(process.cwd(), 'src/__tests__/fixtures/rownative', name), 'utf8');
}

function course(id: number): RownativeCourseGeometryInput & { distance_m?: number; country?: string; status?: string } {
  return JSON.parse(fixture(`${id}.json`));
}

/** Every fixture id, so the whole-set criteria (AC-5, AC-6) really cover the set. */
const ALL_FIXTURES = [1, 61, 153, 175, 179, 237, 257, 277];

/**
 * The gate-chain algorithm exactly as it stood at 1125b39: sort polygons by
 * `order`, replace each with its vertex mean. AC-3 pins the fallback against
 * this so the fix cannot regress the courses it does not improve.
 */
function legacyGateChain(input: RownativeCourseGeometryInput): Coordinate[] {
  return [...(input.polygons ?? [])]
    .sort((a, b) => (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER))
    .map((polygon) => {
      const points = (polygon.points ?? []).filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon));
      return points.length === 0 ? null : {
        lat: points.reduce((sum, p) => sum + p.lat, 0) / points.length,
        lng: points.reduce((sum, p) => sum + p.lon, 0) / points.length,
      };
    })
    .filter((point): point is Coordinate => point !== null);
}

function gateOffsets(line: Coordinate[], gates: Coordinate[]): number[] {
  return gates.map((gate) => projectPointOntoPolyline(gate, line).offsetMeters);
}

/** The 43-point Clyde track shipped as the R-8 fixture for course 179. */
function castleToCraneTrack(): Coordinate[] {
  return parseTrackFile('179.gpx', fixture('179.gpx'));
}

/** Import a course through the real service with a controlled fetch and store. */
async function importCourse(
  id: number,
  options: { track?: { fileName: string; coordinates: Coordinate[] }; osmProvider?: ConstructorParameters<typeof RownativeService>[3] } = {},
) {
  const routes = new RouteService();
  const tracks = new TrackAttachmentStore();
  tracks.clear();
  if (options.track) tracks.set(String(id), options.track.fileName, options.track.coordinates);

  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => JSON.parse(fixture(`${id}.json`)),
    text: async () => fixture(`${id}.json`),
  } as Response);

  const service = new RownativeService(
    fetchMock as unknown as typeof fetch,
    (data) => routes.importRouteFromRownative(data),
    tracks,
    options.osmProvider ?? null,
  );
  return service.importCourseById(String(id));
}

describe('rownative geometry resolution (issue #194)', () => {
  describe('AC-1 / AC-2 — provenance is set, and precedence is honoured', () => {
    it('reports a track when one is attached and a gate chain when none is', async () => {
      const withTrack = await resolveCourseGeometry(course(179), { attachedTrack: castleToCraneTrack() });
      expect(withTrack.source).toBe('track');

      const withoutTrack = await resolveCourseGeometry(course(179));
      expect(withoutTrack.source).toBe('gate-chain');
    });

    it('tags the route with its geometry source', async () => {
      const tracked = await importCourse(179, { track: { fileName: '179.gpx', coordinates: castleToCraneTrack() } });
      expect(tracked.geometrySource).toBe('track');
      expect(tracked.tags).toContain('geometry:track');

      const gated = await importCourse(179);
      expect(gated.geometrySource).toBe('gate-chain');
      expect(gated.tags).toContain('geometry:gate-chain');
    });

    it('prefers an attached track over the traced polygons course 257 already has', async () => {
      // Nudged ~4 m off the mirror's own trace: still inside gate tolerance, but
      // distinguishable from the polygon vertices.
      const { candidates } = classifyPolygons(course(257));
      const island = candidates.find((candidate) => candidate.name.includes('Fighting Island'))!;
      const attached = island.vertices.map((vertex) => ({ lat: vertex.lat + 0.00004, lng: vertex.lng }));

      const resolved = await resolveCourseGeometry(course(257), { attachedTrack: attached });

      expect(resolved.source).toBe('track');
      for (const point of resolved.coordinates) {
        expect(island.vertices.some((vertex) => vertex.lat === point.lat && vertex.lng === point.lng)).toBe(false);
      }
    });

    it('treats an upstream path field as a track (R-13 / AC-14)', async () => {
      // A future mirror schema addition must need no VirtualRow change.
      const base = course(1);
      const chain = legacyGateChain(base);
      const path = Array.from({ length: 120 }, (_, i) => {
        const t = i / 119;
        return {
          lat: chain[0].lat + (chain[1].lat - chain[0].lat) * t,
          lon: chain[0].lng + (chain[1].lng - chain[0].lng) * t,
        };
      });

      const resolved = await resolveCourseGeometry({ ...base, path });

      expect(resolved.source).toBe('track');
      expect(resolved.coordinates.length).toBeGreaterThan(2);
    });
  });

  describe('AC-3 — the fallback is regression-free', () => {
    it.each([1, 61, 153, 237])('course %i still resolves to the 1125b39 gate chain', async (id) => {
      const resolved = await resolveCourseGeometry(course(id));
      expect(resolved.source).toBe('gate-chain');
      expect(resolved.coordinates).toEqual(legacyGateChain(course(id)));
    });
  });

  describe('AC-4 — path-shaped polygons are used as paths', () => {
    it('trims course 277 to the gate-to-gate portion of its Route polygon', async () => {
      const resolved = await resolveCourseGeometry(course(277));
      const { gates } = classifyPolygons(course(277));

      expect(resolved.source).toBe('polygon-path');
      // The 37-vertex Start and Finish polygons are gates, not paths.
      expect(gates.map((gate) => gate.name)).toEqual(['Start', 'Finish']);

      const line = resolved.coordinates;
      expect(distanceBetweenMeters(line[0], gates[0].center)).toBeLessThanOrEqual(GATE_TOLERANCE_M);
      expect(distanceBetweenMeters(line[line.length - 1], gates[1].center)).toBeLessThanOrEqual(GATE_TOLERANCE_M);
      // 10.19 km between the gates, not the 13.27 km the whole trace runs to.
      expect(polylineLengthMeters(line) / 1000).toBeCloseTo(10.2, 1);
    });

    it('rows course 257 as the full Fighting Island loop and drops the other trace', async () => {
      const resolved = await resolveCourseGeometry(course(257));
      const { gates, candidates } = classifyPolygons(course(257));

      expect(resolved.source).toBe('polygon-path');
      expect(polylineLengthMeters(resolved.coordinates) / 1000).toBeCloseTo(20.7, 0);

      // Starts at the Start gate…
      const start = gates.find((gate) => gate.name === 'Start')!;
      expect(distanceBetweenMeters(resolved.coordinates[0], start.center)).toBeLessThanOrEqual(GATE_TOLERANCE_M);
      // …and every waypoint is on the line.
      for (const offset of gateOffsets(resolved.coordinates, gates.map((gate) => gate.center))) {
        expect(offset).toBeLessThanOrEqual(GATE_TOLERANCE_M);
      }

      // "Around Grassy" misses WP4/WP5 by hundreds of metres and is discarded,
      // not folded back in as a gate.
      const grassy = candidates.find((candidate) => candidate.name.includes('Grassy'))!;
      for (const vertex of grassy.vertices) {
        expect(resolved.coordinates).not.toContainEqual(vertex);
      }
      expect(resolved.warnings.join(' ')).toContain('Around Grassy');
    });

    it('sends course 237 back to gates when its long waypoints are not a path', async () => {
      const resolved = await resolveCourseGeometry(course(237));

      expect(resolved.source).toBe('gate-chain');
      expect(resolved.coordinates).toEqual(legacyGateChain(course(237)));
      expect(resolved.warnings.join(' ')).toContain('gate outline');
    });

    it('keeps course 61 "Gate 1" a gate despite its 13 vertices', () => {
      const { gates, candidates } = classifyPolygons(course(61));

      expect(candidates).toHaveLength(0);
      expect(gates.map((gate) => gate.name)).toContain('Gate 1');
    });
  });

  describe('AC-5 — gates are honoured', () => {
    it.each(ALL_FIXTURES.filter((id) => id !== 175))('every gate of course %i lies on the final polyline', async (id) => {
      const resolved = await resolveCourseGeometry(course(id));
      for (const offset of gateOffsets(resolved.coordinates, resolved.gates)) {
        expect(offset).toBeLessThanOrEqual(GATE_TOLERANCE_M);
      }
    });

    it('rejects a track that bypasses the finish gate, naming it, and falls back', async () => {
      const track = castleToCraneTrack();
      // Drag the tail ~300 m north so the line misses the finish gate entirely.
      const bypass = track.map((point, index) => (
        index >= track.length - 3 ? { lat: point.lat + 0.0027, lng: point.lng } : point
      ));
      const { gates } = classifyPolygons(course(179));

      const fit = fitCandidateToGates(bypass, gates);
      expect(fit.ok).toBe(false);
      if (!fit.ok) {
        expect(fit.error.gateName).toBe('Finish');
        expect(fit.error.message).toContain('Finish');
        expect(fit.error.offsetMeters).toBeGreaterThan(150);
      }

      const resolved = await resolveCourseGeometry(course(179), { attachedTrack: bypass });
      expect(resolved.source).toBe('gate-chain');
      expect(resolved.warnings.join(' ')).toContain('Finish');
    });
  });

  describe('AC-6 — one distance, taken from the geometry', () => {
    it.each(ALL_FIXTURES.filter((id) => id !== 175))('course %i reports the length it actually rows', async (id) => {
      const route = await importCourse(id);
      expect(Math.abs(route.distance * 1000 - polylineLengthMeters(route.coordinates))).toBeLessThan(1);
    });

    it('gives Castle to Crane its real length once a track is attached', async () => {
      const route = await importCourse(179, { track: { fileName: '179.gpx', coordinates: castleToCraneTrack() } });

      // ~13 miles of river, not the 19.6 km straight line the mirror declares.
      expect(route.distance).toBeGreaterThan(20);
      expect(route.distance).toBeLessThan(23);
      expect(route.externalDistanceMeters).toBe(19599);
    });
  });

  describe('AC-7 — the card and the boat agree', () => {
    it('rowing the distance on the card puts the boat at the end of the course', async () => {
      const route = await importCourse(179, { track: { fileName: '179.gpx', coordinates: castleToCraneTrack() } });

      // What the engine measures the route as, from the same coordinates.
      const engineTotal = routeTotalDistanceMeters(route.coordinates);
      expect(Math.abs(engineTotal - route.distance * 1000)).toBeLessThan(1);

      // …and what it does with a rower's distance readings along the way.
      const curve = createRouteCurve(route.coordinates, 0.1)!;
      const distances = getCurveDistances(curve);
      const curveLength = distances[distances.length - 1];

      expect(distanceToProgress(engineTotal, engineTotal, distances, curveLength)).toBeCloseTo(1, 2);
      expect(distanceToProgress(engineTotal / 2, engineTotal, distances, curveLength)).toBeCloseTo(0.5, 1);
      expect(distanceToProgress(0, engineTotal, distances, curveLength)).toBeCloseTo(0, 2);
    });
  });

  describe('AC-8 — out-and-back courses are refused, not stubbed', () => {
    it('refuses course 175 and says how to fix it', async () => {
      await expect(resolveCourseGeometry(course(175))).rejects.toBeInstanceOf(RownativeGeometryUnavailableError);
      await expect(resolveCourseGeometry(course(175))).rejects.toThrow(/attach a track/i);
      await expect(importCourse(175)).rejects.toBeInstanceOf(RownativeGeometryUnavailableError);
    });

    it('imports course 175 once a 5 km out-and-back track is attached', async () => {
      const { gates } = classifyPolygons(course(175));
      const [start, finish] = gates.map((gate) => gate.center);
      // Out 2.5 km due east and back, starting on Start and ending on Finish.
      const out = Array.from({ length: 26 }, (_, i) => ({
        lat: start.lat,
        lng: start.lng + (i * 2500) / 26 / (111_320 * Math.cos((start.lat * Math.PI) / 180)),
      }));
      const track = [...out, ...out.slice(0, -1).reverse().map((p) => ({ ...p })), finish];

      const route = await importCourse(175, { track: { fileName: '175.gpx', coordinates: track } });

      expect(route.geometrySource).toBe('track');
      expect(route.distance).toBeCloseTo(5, 0);
    });
  });

  describe('AC-9 — the badge follows provenance, not point count', () => {
    it('tags course 153 (35 gates) as gates-only', async () => {
      const route = await importCourse(153);
      expect(route.geometrySource).toBe('gate-chain');
      expect(route.tags).toContain('outline-only');
    });

    it('does not tag course 179 with a 9-point track as gates-only', async () => {
      const full = castleToCraneTrack();
      const sparse = [full[0], ...full.filter((_, i) => i % 6 === 0 && i > 0).slice(0, 7), full[full.length - 1]];
      expect(sparse).toHaveLength(9);

      const route = await importCourse(179, { track: { fileName: 'sparse.gpx', coordinates: sparse } });

      expect(route.geometrySource).toBe('track');
      expect(route.tags).not.toContain('outline-only');
    });
  });

  describe('AC-13 — a failing OSM provider is invisible', () => {
    const failures: [string, () => Promise<Response>][] = [
      ['a 5xx response', async () => ({ ok: false, status: 502, json: async () => ({}) } as Response)],
      ['a timeout', () => new Promise<Response>((_, reject) => reject(new DOMException('Aborted', 'AbortError')))],
      ['malformed JSON', async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('bad json'); } } as unknown as Response)],
    ];

    it.each(failures)('imports through %s without stalling or throwing', async (_label, respond) => {
      const provider = new OsmWaterwayPathProvider(respond as unknown as typeof fetch);
      const started = performance.now();

      const resolved = await resolveCourseGeometry(course(61), { osmProvider: provider });

      expect(resolved.source).toBe('gate-chain');
      expect(performance.now() - started).toBeLessThan(100);
    });

    it('uses an OSM path when the provider does return one', async () => {
      const { gates } = classifyPolygons(course(61));
      const provider = { findPath: async () => gates.map((gate) => gate.center) };

      const resolved = await resolveCourseGeometry(course(61), { osmProvider: provider });

      expect(resolved.source).toBe('osm-derived');
    });
  });
});
