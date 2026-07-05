import { afterEach, describe, expect, it, vi } from 'vitest';
import { RownativeService } from '../services/rownativeService';
import { RouteService } from '../services/routeService';

describe('RownativeService', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('searches courses by name from the index', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        { id: '1', name: 'Amsterdam Canal Sprint', country: 'Netherlands', distance_m: 2000 },
        { id: '2', name: 'Boston Head Course', country: 'United States', distance_m: 4800 },
      ],
    } as Response);

    const service = new RownativeService(fetchMock as unknown as typeof fetch);
    const results = await service.searchCourses('amsterdam');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('1');
    expect(results[0].distanceMeters).toBe(2000);
  });

  it('imports a course and creates a rownative WaterRoute', async () => {
    const isolatedRouteService = new RouteService();
    const initialCount = isolatedRouteService.getAllRoutes().length;
    const fetchMock = vi.fn()
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

    const service = new RownativeService(
      fetchMock as unknown as typeof fetch,
      (data) => isolatedRouteService.importRouteFromRownative(data),
    );
    const [course] = await service.searchCourses('river');
    const imported = await service.importCourse(course);

    expect(imported.source).toBe('rownative');
    expect(imported.distance).toBe(6.2);
    expect(imported.coordinates).toHaveLength(2);
    expect(isolatedRouteService.getAllRoutes().length).toBe(initialCount + 1);
  });

  it('throws a helpful error when course geometry has insufficient points', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [{ id: '9', name: 'Broken Course', country: 'Unknown', distance_m: 1000 }],
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: '9',
          name: 'Broken Course',
          polygons: [{ order: 0, points: [{ lat: 1, lon: 2 }] }],
        }),
      } as Response);

    const service = new RownativeService(fetchMock as unknown as typeof fetch);
    const [course] = await service.searchCourses('broken');

    await expect(service.importCourse(course)).rejects.toThrow('Broken Course (9) has insufficient coordinate data');
  });

  it('reuses the same in-flight index fetch for concurrent callers', async () => {
    let resolveJson!: (value: Array<{ id: string; name: string; country: string; distance_m: number }>) => void;
    const jsonPromise = new Promise<Array<{ id: string; name: string; country: string; distance_m: number }>>((resolve) => {
      resolveJson = resolve;
    });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => jsonPromise,
    } as Response);

    const service = new RownativeService(fetchMock as unknown as typeof fetch);
    const first = service.searchCourses('river');
    const second = service.searchCourses('river');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    resolveJson([{ id: '1', name: 'River Course', country: 'Germany', distance_m: 6200 }]);

    const [firstResults, secondResults] = await Promise.all([first, second]);
    expect(firstResults).toEqual(secondResults);
  });

  it('does not include raw URLs in HTTP errors', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
    } as Response);

    const service = new RownativeService(fetchMock as unknown as typeof fetch);

    await expect(service.searchCourses('river')).rejects.toThrow(
      'Unable to load rownative course data (HTTP 404). Please try again.',
    );
  });

  it('stores linked account metadata per VirtualRow user after completeLinkFlow', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        rownativeUserId: 'rn-55',
        rownativeDisplayName: 'Rownative User',
        linkedAt: 123,
      }),
    } as Response);

    const service = new RownativeService(fetchMock as unknown as typeof fetch);
    const linked = await service.completeLinkFlow('vr-user-1', 'request-1');

    expect(linked.virtualRowUserId).toBe('vr-user-1');
    expect(linked.rownativeUserId).toBe('rn-55');
    expect(service.getLinkedAccount('vr-user-1')?.rownativeDisplayName).toBe('Rownative User');
    expect(service.getLinkedAccount('vr-user-2')).toBeNull();
  });

  it('rejects invalid route ID input before calling pull endpoint', async () => {
    const fetchMock = vi.fn();
    const service = new RownativeService(fetchMock as unknown as typeof fetch);

    await expect(
      service.pullLinkedRouteKml({
        virtualRowUserId: 'vr-user',
        routeId: '../invalid',
      }),
    ).rejects.toThrow('Route ID is invalid. Use letters, numbers, dash, or underscore only.');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a non-localhost http link URL returned by the worker', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ linkUrl: 'http://evil.example.com/link', requestId: 'req-1' }),
    } as Response);

    const service = new RownativeService(fetchMock as unknown as typeof fetch);
    await expect(service.startLinkFlow('vr-user')).rejects.toThrow('Rownative link setup failed. Please try again.');
  });

  it('accepts a localhost http link URL for local development', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ linkUrl: 'http://localhost:8787/link', requestId: 'req-local' }),
    } as Response);

    const service = new RownativeService(fetchMock as unknown as typeof fetch);
    const result = await service.startLinkFlow('vr-user');
    expect(result.linkUrl).toBe('http://localhost:8787/link');
  });

  it('rejects a localhost http link URL on an unexpected port', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ linkUrl: 'http://localhost:3000/link', requestId: 'req-local' }),
    } as Response);

    const service = new RownativeService(fetchMock as unknown as typeof fetch);
    await expect(service.startLinkFlow('vr-user')).rejects.toThrow('Rownative link setup failed. Please try again.');
  });

  it('rejects a KML response that exceeds MAX_KML_BYTES in encoded byte length', async () => {
    const largeKml = 'x'.repeat(5 * 1024 * 1024 + 1);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ kml: largeKml }),
    } as Response);

    const service = new RownativeService(fetchMock as unknown as typeof fetch);
    await expect(
      service.pullLinkedRouteKml({ virtualRowUserId: 'vr-user' }),
    ).rejects.toThrow('The KML response is too large to import.');
  });

  it('pulls linked KML for a valid route URL', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        kml: '<kml><Document></Document></kml>',
        routeName: 'Pulled Route',
      }),
    } as Response);
    const service = new RownativeService(fetchMock as unknown as typeof fetch);
    const result = await service.pullLinkedRouteKml({
      virtualRowUserId: 'vr-user',
      routeUrl: 'https://rownative.icu/routes/123',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, request] = fetchMock.mock.calls[0];
    expect((request as RequestInit).method).toBe('POST');
    expect(result.kml).toContain('<kml>');
    expect(result.routeName).toBe('Pulled Route');
  });

  it('rejects a route URL outside the trusted rownative domain allowlist', async () => {
    const fetchMock = vi.fn();
    const service = new RownativeService(fetchMock as unknown as typeof fetch);

    await expect(
      service.pullLinkedRouteKml({
        virtualRowUserId: 'vr-user',
        routeUrl: 'https://evil.example.com/routes/123',
      }),
    ).rejects.toThrow('Route URL is invalid.');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
