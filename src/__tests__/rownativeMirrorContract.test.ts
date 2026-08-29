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

  it('reports a known-absent id as not found rather than crashing', async () => {
    const service = new RownativeService();
    // id 2 is absent from the mirror while present on the live site.
    await expect(service.importCourseById('2')).rejects.toThrow(/isn't in the public course data yet/i);
  }, 30_000);
});
