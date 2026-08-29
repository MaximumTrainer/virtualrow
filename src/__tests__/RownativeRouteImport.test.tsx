import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ServicesProvider, defaultServices } from '../context/ServicesContext';
import { RownativeRouteImport } from '../components/RownativeRouteImport';
import type { Services } from '../ports';
import type { WaterRoute } from '../types/index';

function createImportedRoute(name = 'Imported Route'): WaterRoute {
  return {
    id: 'new-route',
    name,
    description: 'desc',
    distance: 4.2,
    difficulty: 'moderate',
    location: 'United States',
    coordinates: [{ lat: 1, lng: 2 }, { lat: 2, lng: 3 }],
    elevationGain: 0,
    estimatedTime: 72,
    tags: ['rownative', 'rownative-id:106'],
    createdAt: new Date(),
    source: 'rownative',
  };
}

describe('RownativeRouteImport', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    sessionStorage.clear();
  });

  function renderWithServices(overrides?: Partial<Services>) {
    const onRouteImported = vi.fn();
    render(
      <ServicesProvider services={{ ...defaultServices, ...overrides }}>
        <RownativeRouteImport onRouteImported={onRouteImported} />
      </ServicesProvider>,
    );
    return { onRouteImported };
  }

  async function openPanel(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole('button', { name: /find a course on rownative\.icu/i }));
  }

  it('offers no account-linking step (linking is not required)', async () => {
    const user = userEvent.setup();
    renderWithServices();
    await openPanel(user);

    expect(screen.queryByRole('button', { name: /link rownative account/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /complete linking/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /unlink/i })).toBeNull();
  });

  it('sends the user to rownative.icu with a return URL and state', async () => {
    const user = userEvent.setup();
    const assign = vi.fn();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...window.location, assign, search: '', origin: 'https://app.test' },
    });

    renderWithServices();
    await openPanel(user);
    await user.click(screen.getByRole('button', { name: /browse courses on rownative\.icu/i }));

    expect(assign).toHaveBeenCalledTimes(1);
    const url = new URL(assign.mock.calls[0][0] as string);
    expect(url.hostname).toBe('rownative.icu');
    expect(url.searchParams.get('virtualrowState')).toBeTruthy();
    expect(url.searchParams.get('virtualrowReturn')).toBeTruthy();
  });

  it('loads a pasted course id through importCourseById', async () => {
    const user = userEvent.setup();
    const route = createImportedRoute('HOTS Stake Race');
    const importCourseById = vi.fn().mockResolvedValue(route);

    const { onRouteImported } = renderWithServices({
      rownativeService: { ...defaultServices.rownativeService, importCourseById } as unknown as Services['rownativeService'],
      routeService: { ...defaultServices.routeService, findRouteByRownativeId: () => undefined } as unknown as Services['routeService'],
    });

    await openPanel(user);
    await user.type(screen.getByLabelText(/rownative course id or link/i), '106');
    await user.click(screen.getByRole('button', { name: /load course/i }));

    expect(importCourseById).toHaveBeenCalledWith('106');
    expect(onRouteImported).toHaveBeenCalledWith(route);
  });

  it('accepts a scheme-less rownative.icu link', async () => {
    const user = userEvent.setup();
    const importCourseById = vi.fn().mockResolvedValue(createImportedRoute());

    renderWithServices({
      rownativeService: { ...defaultServices.rownativeService, importCourseById } as unknown as Services['rownativeService'],
      routeService: { ...defaultServices.routeService, findRouteByRownativeId: () => undefined } as unknown as Services['routeService'],
    });

    await openPanel(user);
    await user.type(screen.getByLabelText(/rownative course id or link/i), 'rownative.icu/course/5');
    await user.click(screen.getByRole('button', { name: /load course/i }));

    expect(importCourseById).toHaveBeenCalledWith('5');
  });

  it('rejects a non-rownative link without calling the service', async () => {
    const user = userEvent.setup();
    const importCourseById = vi.fn();

    renderWithServices({
      rownativeService: { ...defaultServices.rownativeService, importCourseById } as unknown as Services['rownativeService'],
    });

    await openPanel(user);
    await user.type(screen.getByLabelText(/rownative course id or link/i), 'https://evil.example/?course=1');
    await user.click(screen.getByRole('button', { name: /load course/i }));

    expect(importCourseById).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toMatch(/course id/i);
  });

  it('re-selects an already imported course instead of importing it twice', async () => {
    const user = userEvent.setup();
    const existing = createImportedRoute('Already Here');
    const importCourseById = vi.fn();

    const { onRouteImported } = renderWithServices({
      rownativeService: { ...defaultServices.rownativeService, importCourseById } as unknown as Services['rownativeService'],
      routeService: { ...defaultServices.routeService, findRouteByRownativeId: () => existing } as unknown as Services['routeService'],
    });

    await openPanel(user);
    await user.type(screen.getByLabelText(/rownative course id or link/i), '106');
    await user.click(screen.getByRole('button', { name: /load course/i }));

    expect(importCourseById).not.toHaveBeenCalled();
    expect(onRouteImported).toHaveBeenCalledWith(existing);
  });

  it('surfaces a load failure without importing anything', async () => {
    const user = userEvent.setup();
    const importCourseById = vi.fn().mockRejectedValue(new Error('Unable to load rownative course data (HTTP 404). Please try again.'));

    const { onRouteImported } = renderWithServices({
      rownativeService: { ...defaultServices.rownativeService, importCourseById } as unknown as Services['rownativeService'],
      routeService: { ...defaultServices.routeService, findRouteByRownativeId: () => undefined } as unknown as Services['routeService'],
    });

    await openPanel(user);
    await user.type(screen.getByLabelText(/rownative course id or link/i), '999999');
    await user.click(screen.getByRole('button', { name: /load course/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/HTTP 404/);
    expect(onRouteImported).not.toHaveBeenCalled();
  });

  it('disables the load control until something is entered', async () => {
    const user = userEvent.setup();
    renderWithServices();
    await openPanel(user);

    expect(screen.getByRole('button', { name: /load course/i })).toBeDisabled();
    await user.type(screen.getByLabelText(/rownative course id or link/i), '1');
    expect(screen.getByRole('button', { name: /load course/i })).toBeEnabled();
  });
});
