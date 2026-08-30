import { describe, expect, it } from 'vitest';
import { RownativeService } from '../services/rownativeService';
import { RouteService } from '../services/routeService';

/**
 * Contract check against the live GitHub mirror (issue #193 §8).
 *
 * Network-dependent, so it is opt-in rather than part of the default suite —
 * run with ROWNATIVE_CONTRACT_CHECK=1 (e.g. on a schedule) to catch upstream
 * schema drift in the mirror before users hit it.
 */
const enabled = process.env.ROWNATIVE_CONTRACT_CHECK === '1';

describe.skipIf(!enabled)('rownative mirror contract (live network)', () => {
  it('index.json still carries the fields we read', async () => {
    const service = new RownativeService();
    const courses = await service.getCourseIndex();

    expect(courses.length).toBeGreaterThan(100);
    const [first] = courses;
    expect(typeof first.id).toBe('string');
    expect(typeof first.name).toBe('string');
    expect(typeof first.country).toBe('string');
    expect(Number.isFinite(first.distanceMeters)).toBe(true);
  }, 30_000);

  it('a course file still imports into a usable route', async () => {
    const routes = new RouteService();
    const service = new RownativeService(undefined, (d) => routes.importRouteFromRownative(d));
    const route = await service.importCourseById('1');

    expect(route.source).toBe('rownative');
    expect(route.externalId).toBe('1');
    expect(route.name.length).toBeGreaterThan(0);
    expect(route.distance).toBeGreaterThan(0);
    expect(route.coordinates.length).toBeGreaterThanOrEqual(2);
  }, 30_000);

  it('still carries course 257 as traced polygons, not just gates', async () => {
    // Issue #194 AC-16: the live counterpart of the offline polygon-path
    // fixtures. If the mirror ever normalises these traces into gates, the
    // straight-line bug comes back for this course and we want to know.
    const routes = new RouteService();
    const service = new RownativeService(undefined, (d) => routes.importRouteFromRownative(d));
    const route = await service.importCourseById('257');

    expect(route.geometrySource).toBe('polygon-path');
    expect(route.distance).toBeGreaterThan(20);
    expect(route.tags).not.toContain('outline-only');
  }, 30_000);

  it('accepts an optional top-level path field, if upstream ever adds one', async () => {
    // Issue #194 R-13/R-14: the field is not in the schema yet. Assert its
    // shape only when present, so the day it lands we read it rather than
    // break on it.
    const service = new RownativeService();
    const course = await service.fetchCourseGeometry('1') as { path?: unknown };

    if (course.path !== undefined) {
      expect(Array.isArray(course.path)).toBe(true);
      for (const point of course.path as { lat: unknown; lon: unknown }[]) {
        expect(typeof point.lat).toBe('number');
        expect(typeof point.lon).toBe('number');
      }
    }
  }, 30_000);

  it('reports a known-absent id as not found rather than crashing', async () => {
    const service = new RownativeService();
    // id 2 is absent from the mirror while present on the live site.
    await expect(service.importCourseById('2')).rejects.toThrow(/isn't in the public course data yet/i);
  }, 30_000);
});
