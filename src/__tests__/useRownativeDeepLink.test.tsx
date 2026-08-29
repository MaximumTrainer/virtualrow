import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { ServicesProvider, defaultServices } from '../context/ServicesContext';
import { resetDeepLinkForTests, useRownativeDeepLink } from '../hooks/useRownativeDeepLink';
import type { Services } from '../ports';
import type { WaterRoute } from '../types/index';

function makeRoute(name = 'Deep Linked Course'): WaterRoute {
  return {
    id: 'r1', name, description: '', distance: 5.35, difficulty: 'moderate',
    location: 'United States', coordinates: [{ lat: 1, lng: 2 }, { lat: 2, lng: 3 }],
    elevationGain: 0, estimatedTime: 92, tags: ['rownative'], createdAt: new Date(),
    source: 'rownative', externalId: '5',
  };
}

function Harness({ onRouteLoaded, isReady }: { onRouteLoaded: (r: WaterRoute) => void; isReady?: boolean }) {
  const { status } = useRownativeDeepLink({ onRouteLoaded, isReady });
  return <div data-testid="status">{status.kind === 'error' ? status.message : status.kind}</div>;
}

function renderHook(search: string, overrides?: Partial<Services>, isReady = true) {
  window.history.replaceState({}, '', `/${search}`);
  const onRouteLoaded = vi.fn();
  const utils = render(
    <ServicesProvider services={{ ...defaultServices, ...overrides }}>
      <Harness onRouteLoaded={onRouteLoaded} isReady={isReady} />
    </ServicesProvider>,
  );
  return { onRouteLoaded, ...utils };
}

const noExistingRoute = {
  ...defaultServices.routeService,
  findRouteByRownativeId: () => undefined,
} as unknown as Services['routeService'];

describe('useRownativeDeepLink', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    window.history.replaceState({}, '', '/');
    resetDeepLinkForTests();
  });

  it('does nothing when the URL carries no course id', () => {
    const importCourseById = vi.fn();
    const { onRouteLoaded } = renderHook('', {
      rownativeService: { ...defaultServices.rownativeService, importCourseById } as unknown as Services['rownativeService'],
    });

    expect(screen.getByTestId('status').textContent).toBe('idle');
    expect(importCourseById).not.toHaveBeenCalled();
    expect(onRouteLoaded).not.toHaveBeenCalled();
  });

  it('imports the course named in the URL — no state nonce required (AC-2)', async () => {
    const route = makeRoute();
    const importCourseById = vi.fn().mockResolvedValue(route);
    const { onRouteLoaded } = renderHook('?rownativeCourseId=5', {
      rownativeService: { ...defaultServices.rownativeService, importCourseById } as unknown as Services['rownativeService'],
      routeService: noExistingRoute,
    });

    await waitFor(() => expect(onRouteLoaded).toHaveBeenCalledWith(route));
    expect(importCourseById).toHaveBeenCalledWith('5');
  });

  it('strips the param exactly once so a refresh does not re-import (AC-2)', async () => {
    const importCourseById = vi.fn().mockResolvedValue(makeRoute());
    const { unmount } = renderHook('?rownativeCourseId=5', {
      rownativeService: { ...defaultServices.rownativeService, importCourseById } as unknown as Services['rownativeService'],
      routeService: noExistingRoute,
    });

    await waitFor(() => expect(new URLSearchParams(window.location.search).get('rownativeCourseId')).toBeNull());
    unmount();

    // Simulate an actual refresh: fresh module state, reading the cleaned URL.
    resetDeepLinkForTests();
    render(
      <ServicesProvider services={{
        ...defaultServices,
        rownativeService: { ...defaultServices.rownativeService, importCourseById } as unknown as Services['rownativeService'],
        routeService: noExistingRoute,
      }}>
        <Harness onRouteLoaded={vi.fn()} />
      </ServicesProvider>,
    );
    expect(importCourseById).toHaveBeenCalledTimes(1);
  });

  it('preserves unrelated query params and the hash while stripping ours', async () => {
    window.history.replaceState({}, '', '/?keep=1&rownativeCourseId=5&state=legacy#section');
    render(
      <ServicesProvider services={{
        ...defaultServices,
        rownativeService: { ...defaultServices.rownativeService, importCourseById: vi.fn().mockResolvedValue(makeRoute()) } as unknown as Services['rownativeService'],
        routeService: noExistingRoute,
      }}>
        <Harness onRouteLoaded={vi.fn()} />
      </ServicesProvider>,
    );

    await waitFor(() => {
      const params = new URLSearchParams(window.location.search);
      expect(params.get('rownativeCourseId')).toBeNull();
      // Legacy nonce from the abandoned redirect design is tolerated and stripped.
      expect(params.get('state')).toBeNull();
      expect(params.get('keep')).toBe('1');
      expect(window.location.hash).toBe('#section');
    });
  });

  it('holds the import until the app is ready, then runs it (RS-5)', async () => {
    const route = makeRoute();
    const importCourseById = vi.fn().mockResolvedValue(route);
    const services = {
      ...defaultServices,
      rownativeService: { ...defaultServices.rownativeService, importCourseById } as unknown as Services['rownativeService'],
      routeService: noExistingRoute,
    };
    window.history.replaceState({}, '', '/?rownativeCourseId=5');
    const onRouteLoaded = vi.fn();

    const { rerender } = render(
      <ServicesProvider services={services}>
        <Harness onRouteLoaded={onRouteLoaded} isReady={false} />
      </ServicesProvider>,
    );
    expect(importCourseById).not.toHaveBeenCalled();

    rerender(
      <ServicesProvider services={services}>
        <Harness onRouteLoaded={onRouteLoaded} isReady={true} />
      </ServicesProvider>,
    );
    await waitFor(() => expect(importCourseById).toHaveBeenCalledWith('5'));
  });

  it('selects an already imported course instead of importing twice (AC-5)', async () => {
    const existing = makeRoute('Already Imported');
    const importCourseById = vi.fn();
    const { onRouteLoaded } = renderHook('?rownativeCourseId=5', {
      rownativeService: { ...defaultServices.rownativeService, importCourseById } as unknown as Services['rownativeService'],
      routeService: { ...defaultServices.routeService, findRouteByRownativeId: () => existing } as unknown as Services['routeService'],
    });

    await waitFor(() => expect(onRouteLoaded).toHaveBeenCalledWith(existing));
    expect(importCourseById).not.toHaveBeenCalled();
  });

  it('surfaces a load failure and creates no route (AC-3)', async () => {
    const { onRouteLoaded } = renderHook('?rownativeCourseId=2', {
      rownativeService: {
        ...defaultServices.rownativeService,
        importCourseById: vi.fn().mockRejectedValue(new Error("Course 2 isn't in the public course data yet.")),
      } as unknown as Services['rownativeService'],
      routeService: noExistingRoute,
    });

    await waitFor(() => expect(screen.getByTestId('status').textContent).toMatch(/isn't in the public course data yet/i));
    expect(onRouteLoaded).not.toHaveBeenCalled();
  });

  it('rejects a malformed id via the service, making no route', async () => {
    const importCourseById = vi.fn().mockRejectedValue(new Error('Enter a rownative course ID or a rownative.icu course link.'));
    const { onRouteLoaded } = renderHook(`?rownativeCourseId=${encodeURIComponent('../../etc/passwd')}`, {
      rownativeService: { ...defaultServices.rownativeService, importCourseById } as unknown as Services['rownativeService'],
      routeService: noExistingRoute,
    });

    await waitFor(() => expect(screen.getByTestId('status').textContent).toMatch(/course ID or a rownative\.icu course link/i));
    expect(onRouteLoaded).not.toHaveBeenCalled();
  });
});
