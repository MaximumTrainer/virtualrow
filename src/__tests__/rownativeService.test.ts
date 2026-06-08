import { afterEach, describe, expect, it, vi } from 'vitest';
import { RownativeService } from '../services/rownativeService';
import { routeService } from '../services/routeService';

describe('RownativeService', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('searches courses by name from the index', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => [
        { id: '1', name: 'Amsterdam Canal Sprint', country: 'Netherlands', distance_m: 2000 },
        { id: '2', name: 'Boston Head Course', country: 'United States', distance_m: 4800 },
      ],
    } as Response);

    const service = new RownativeService();
    const results = await service.searchCourses('amsterdam');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('1');
    expect(results[0].distanceMeters).toBe(2000);
  });

  it('imports a course and creates a rownative WaterRoute', async () => {
    const initialCount = routeService.getAllRoutes().length;
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [{ id: '77', name: 'River Course', country: 'Germany', distance_m: 6200 }],
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: '77',
          name: 'River Course',
          country: 'Germany',
          distance_m: 6200,
          status: 'provisional',
          polygons: [
            { order: 0, points: [{ lat: 52.5, lon: 13.4 }, { lat: 52.51, lon: 13.41 }, { lat: 52.5, lon: 13.42 }] },
            { order: 1, points: [{ lat: 52.52, lon: 13.43 }, { lat: 52.53, lon: 13.44 }, { lat: 52.52, lon: 13.45 }] },
          ],
        }),
      } as Response);

    const service = new RownativeService();
    const [course] = await service.searchCourses('river');
    const imported = await service.importCourse(course);

    expect(imported.source).toBe('rownative');
    expect(imported.distance).toBe(6.2);
    expect(imported.coordinates).toHaveLength(2);
    expect(routeService.getAllRoutes().length).toBe(initialCount + 1);
  });
});
