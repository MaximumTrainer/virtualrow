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

/**
 * A mirror course that ships a top-level `path` (issue #208).
 *
 * 277 is "9K Heerenveens Kanaal", the first course upstream published with the
 * field after it was added to SCHEMA.md.
 */
const PATH_COURSE_ID = '277';

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

  it('reads the upstream path field on the course that ships one', async () => {
    // Issue #208 AC-3. This test used to fetch course 1 — which has no path —
    // and wrap its assertions in `if (course.path !== undefined)`, so it passed
    // without testing anything. Upstream has since added the field (SCHEMA.md
    // "Path (optional)") and course 277 carries a real one, so the guard is
    // gone and the course is one that actually has the data.
    const service = new RownativeService();
    const course = (await service.fetchCourseGeometry(PATH_COURSE_ID)) as {
      path?: { lat: unknown; lon: unknown }[];
    };

    expect(
      course.path,
      `course ${PATH_COURSE_ID} no longer ships a path; pick another that does`,
    ).toBeDefined();
    expect(Array.isArray(course.path)).toBe(true);
    expect(course.path!.length).toBeGreaterThanOrEqual(2);
    for (const point of course.path!) {
      expect(typeof point.lat).toBe('number');
      expect(typeof point.lon).toBe('number');
    }
  }, 30_000);

  it('imports a course with a path as traced geometry, not a gate chain', async () => {
    // The point of the field: a consumer that draws the course gets the line
    // the crew rows instead of straight gate-to-gate hops. Asserting the shape
    // parses would not have caught the importer ignoring it.
    const routes = new RouteService();
    const service = new RownativeService(undefined, (d) => routes.importRouteFromRownative(d));

    const route = await service.importCourseById(PATH_COURSE_ID);

    expect(route.geometrySource).toBe('track');
    expect(route.coordinates.length).toBeGreaterThanOrEqual(2);
    expect(route.coordinates.every((c) => Number.isFinite(c.lat) && Number.isFinite(c.lng))).toBe(
      true,
    );
  }, 30_000);

  it('reports a known-absent id as not found rather than crashing', async () => {
    const service = new RownativeService();
    // id 2 is absent from the mirror while present on the live site.
    // Same wording `rownativeService.test.ts` pins offline. This assertion had
    // drifted from it: the copy became "public mirror" and nothing noticed,
    // because this file only runs under ROWNATIVE_CONTRACT_CHECK=1 (#208 AC-3).
    await expect(service.importCourseById('2')).rejects.toThrow(/isn't in the public mirror yet/i);
  }, 30_000);
});
