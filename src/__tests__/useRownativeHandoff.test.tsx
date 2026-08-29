import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { ServicesProvider, defaultServices } from '../context/ServicesContext';
import { resetHandoffResolutionForTests, useRownativeHandoff } from '../hooks/useRownativeHandoff';
import type { Services } from '../ports';
import type { WaterRoute } from '../types/index';
import { startHandoff } from '../utils/rownativeHandoff';

function makeRoute(name = 'Handed Off Course'): WaterRoute {
  return {
    id: 'r1', name, description: '', distance: 4.8, difficulty: 'moderate',
    location: 'United States', coordinates: [{ lat: 1, lng: 2 }, { lat: 2, lng: 3 }],
    elevationGain: 0, estimatedTime: 82, tags: ['rownative'], createdAt: new Date(),
    source: 'rownative',
  };
}

function Harness({ onRouteLoaded }: { onRouteLoaded: (r: WaterRoute) => void }) {
  const { status } = useRownativeHandoff({ onRouteLoaded });
  return <div data-testid="status">{status.kind === 'error' ? status.message : status.kind}</div>;
}

function renderHook(search: string, overrides?: Partial<Services>) {
  window.history.replaceState({}, '', `/${search}`);
  const onRouteLoaded = vi.fn();
  render(
    <ServicesProvider services={{ ...defaultServices, ...overrides }}>
      <Harness onRouteLoaded={onRouteLoaded} />
    </ServicesProvider>,
  );
  return { onRouteLoaded };
}

/** Issue a real nonce the way the outbound trip would, and return it. */
function issueState(): string {
  return new URL(startHandoff()).searchParams.get('virtualrowState')!;
}

describe('useRownativeHandoff', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    sessionStorage.clear();
    window.history.replaceState({}, '', '/');
    resetHandoffResolutionForTests();
  });

  it('does nothing when the URL carries no handoff', () => {
    const importCourseById = vi.fn();
    const { onRouteLoaded } = renderHook('', {
      rownativeService: { ...defaultServices.rownativeService, importCourseById } as unknown as Services['rownativeService'],
    });

    expect(screen.getByTestId('status').textContent).toBe('idle');
    expect(importCourseById).not.toHaveBeenCalled();
    expect(onRouteLoaded).not.toHaveBeenCalled();
  });

  it('loads the course when the state nonce is valid', async () => {
    const route = makeRoute();
    const importCourseById = vi.fn().mockResolvedValue(route);
    const state = issueState();

    const { onRouteLoaded } = renderHook(`?rownativeCourseId=106&rownativeState=${state}`, {
      rownativeService: { ...defaultServices.rownativeService, importCourseById } as unknown as Services['rownativeService'],
      routeService: { ...defaultServices.routeService, findRouteByRownativeId: () => undefined } as unknown as Services['routeService'],
    });

    await waitFor(() => expect(onRouteLoaded).toHaveBeenCalledWith(route));
    expect(importCourseById).toHaveBeenCalledWith('106');
  });

  it('refuses a forged link with no state, and makes no request', async () => {
    const importCourseById = vi.fn();
    const { onRouteLoaded } = renderHook('?rownativeCourseId=106', {
      rownativeService: { ...defaultServices.rownativeService, importCourseById } as unknown as Services['rownativeService'],
    });

    await waitFor(() => expect(screen.getByTestId('status').textContent).toMatch(/expired/i));
    expect(importCourseById).not.toHaveBeenCalled();
    expect(onRouteLoaded).not.toHaveBeenCalled();
  });

  it('refuses a state that was never issued', async () => {
    const importCourseById = vi.fn();
    issueState();
    renderHook('?rownativeCourseId=106&rownativeState=forged', {
      rownativeService: { ...defaultServices.rownativeService, importCourseById } as unknown as Services['rownativeService'],
    });

    await waitFor(() => expect(screen.getByTestId('status').textContent).toMatch(/expired/i));
    expect(importCourseById).not.toHaveBeenCalled();
  });

  it('rejects a malformed course id before any request', async () => {
    const importCourseById = vi.fn();
    const state = issueState();
    renderHook(`?rownativeCourseId=${encodeURIComponent('../../etc/passwd')}&rownativeState=${state}`, {
      rownativeService: { ...defaultServices.rownativeService, importCourseById } as unknown as Services['rownativeService'],
    });

    await waitFor(() => expect(screen.getByTestId('status').textContent).toMatch(/invalid course reference/i));
    expect(importCourseById).not.toHaveBeenCalled();
  });

  it('strips the handoff params so a refresh cannot replay it', async () => {
    const state = issueState();
    renderHook(`?rownativeCourseId=106&rownativeState=${state}`, {
      rownativeService: {
        ...defaultServices.rownativeService,
        importCourseById: vi.fn().mockResolvedValue(makeRoute()),
      } as unknown as Services['rownativeService'],
      routeService: { ...defaultServices.routeService, findRouteByRownativeId: () => undefined } as unknown as Services['routeService'],
    });

    await waitFor(() => {
      const params = new URLSearchParams(window.location.search);
      expect(params.get('rownativeCourseId')).toBeNull();
      expect(params.get('rownativeState')).toBeNull();
    });
  });

  it('re-selects an already imported course rather than importing twice', async () => {
    const existing = makeRoute('Already Imported');
    const importCourseById = vi.fn();
    const state = issueState();

    const { onRouteLoaded } = renderHook(`?rownativeCourseId=106&rownativeState=${state}`, {
      rownativeService: { ...defaultServices.rownativeService, importCourseById } as unknown as Services['rownativeService'],
      routeService: { ...defaultServices.routeService, findRouteByRownativeId: () => existing } as unknown as Services['routeService'],
    });

    await waitFor(() => expect(onRouteLoaded).toHaveBeenCalledWith(existing));
    expect(importCourseById).not.toHaveBeenCalled();
  });

  it('surfaces an import failure and loads nothing', async () => {
    const state = issueState();
    const { onRouteLoaded } = renderHook(`?rownativeCourseId=999999&rownativeState=${state}`, {
      rownativeService: {
        ...defaultServices.rownativeService,
        importCourseById: vi.fn().mockRejectedValue(new Error('Unable to load rownative course data (HTTP 404). Please try again.')),
      } as unknown as Services['rownativeService'],
      routeService: { ...defaultServices.routeService, findRouteByRownativeId: () => undefined } as unknown as Services['routeService'],
    });

    await waitFor(() => expect(screen.getByTestId('status').textContent).toMatch(/HTTP 404/));
    expect(onRouteLoaded).not.toHaveBeenCalled();
  });
});
