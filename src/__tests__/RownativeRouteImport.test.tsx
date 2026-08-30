import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ServicesProvider } from '../context/ServicesContext';
import { defaultServices } from '../context/useServices';
import { RownativeRouteImport } from '../components/RownativeRouteImport';
import { RownativeCourseNotFoundError } from '../services/rownativeService';
import type { Services } from '../ports';
import type { WaterRoute } from '../types/index';

function createRoute(name = 'Quinsig S to N', externalId = '5'): WaterRoute {
  return {
    id: 'new-route', name, description: 'desc', distance: 5.35, difficulty: 'moderate',
    location: 'United States', coordinates: [{ lat: 1, lng: 2 }, { lat: 2, lng: 3 }],
    elevationGain: 0, estimatedTime: 92, tags: ['rownative'], createdAt: new Date(),
    source: 'rownative', externalId,
  };
}

const COURSES = [
  { id: '5', name: 'Quinsig S to N', country: 'United States', distanceMeters: 5349, status: 'established' },
  { id: '106', name: 'HOTS Stake Race', country: 'United States', distanceMeters: 4804, status: 'provisional' },
];

/** Real resolveCourseId — input validation is part of what these tests exercise. */
const realResolve = defaultServices.rownativeService.resolveCourseId.bind(defaultServices.rownativeService);

describe('RownativeRouteImport', () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  function renderWithServices(overrides?: Partial<Services>) {
    const onRouteImported = vi.fn();
    render(
      <ServicesProvider services={{ ...defaultServices, ...overrides }}>
        <RownativeRouteImport onRouteImported={onRouteImported} />
      </ServicesProvider>,
    );
    return { onRouteImported };
  }

  function rownative(overrides: Record<string, unknown>) {
    return {
      ...defaultServices.rownativeService,
      resolveCourseId: realResolve,
      ...overrides,
    } satisfies Services['rownativeService'];
  }

  const noExisting = { ...defaultServices.routeService, findRouteByRownativeId: () => undefined } satisfies Services['routeService'];

  async function open(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole('button', { name: /add a rownative\.icu course/i }));
  }

  it('offers no account-linking controls at all', async () => {
    const user = userEvent.setup();
    renderWithServices();
    await open(user);

    expect(screen.queryByRole('button', { name: /link rownative account/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /complete linking/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /unlink/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /pull route kml/i })).toBeNull();
  });

  it('links out to rownative.icu for browsing', async () => {
    const user = userEvent.setup();
    renderWithServices();
    await open(user);

    const link = screen.getByRole('link', { name: /browse rownative\.icu/i });
    expect(link).toHaveAttribute('href', 'https://rownative.icu/');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
  });

  it('imports a pasted course id (AC-1)', async () => {
    const user = userEvent.setup();
    const route = createRoute();
    const importCourseById = vi.fn().mockResolvedValue(route);
    const { onRouteImported } = renderWithServices({
      rownativeService: rownative({ importCourseById }),
      routeService: noExisting,
    });

    await open(user);
    await user.type(screen.getByLabelText(/rownative course id or link/i), '5');
    await user.click(screen.getByRole('button', { name: /^import$/i }));

    expect(importCourseById).toHaveBeenCalledWith('5');
    expect(onRouteImported).toHaveBeenCalledWith(route);
  });

  it('imports a pasted rownative.icu course link (AC-1)', async () => {
    const user = userEvent.setup();
    const importCourseById = vi.fn().mockResolvedValue(createRoute());
    renderWithServices({ rownativeService: rownative({ importCourseById }), routeService: noExisting });

    await open(user);
    await user.type(screen.getByLabelText(/rownative course id or link/i), 'https://rownative.icu/course/5');
    await user.click(screen.getByRole('button', { name: /^import$/i }));

    expect(importCourseById).toHaveBeenCalledWith('5');
  });

  it('rejects a foreign host client-side, making no request (AC-4)', async () => {
    const user = userEvent.setup();
    const importCourseById = vi.fn();
    renderWithServices({ rownativeService: rownative({ importCourseById }) });

    await open(user);
    await user.type(screen.getByLabelText(/rownative course id or link/i), 'https://evil.example/course/5');
    await user.click(screen.getByRole('button', { name: /^import$/i }));

    expect(importCourseById).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toMatch(/https:\/\/ links on rownative\.icu/i);
  });

  it('rejects an http link client-side, making no request (AC-4)', async () => {
    const user = userEvent.setup();
    const importCourseById = vi.fn();
    renderWithServices({ rownativeService: rownative({ importCourseById }) });

    await open(user);
    await user.type(screen.getByLabelText(/rownative course id or link/i), 'http://rownative.icu/course/5');
    await user.click(screen.getByRole('button', { name: /^import$/i }));

    expect(importCourseById).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('offers a search-by-name shortcut when the id is missing from the mirror (AC-3)', async () => {
    const user = userEvent.setup();
    const importCourseById = vi.fn().mockRejectedValue(
      new RownativeCourseNotFoundError("Course 2 isn't in the public course data yet.", '2'),
    );
    const searchCourses = vi.fn().mockResolvedValue(COURSES);
    const { onRouteImported } = renderWithServices({
      rownativeService: rownative({
        importCourseById,
        searchCourses,
        getCourseIndex: vi.fn().mockResolvedValue(COURSES),
      }),
      routeService: noExisting,
    });

    await open(user);
    await user.type(screen.getByLabelText(/rownative course id or link/i), '2');
    await user.click(screen.getByRole('button', { name: /^import$/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/isn't in the public course data yet/i);
    expect(onRouteImported).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: /search by name/i }));
    expect(await screen.findByText(/showing 2 of 2 courses/i)).toBeInTheDocument();
  });

  it('searches the catalogue by name and imports a result', async () => {
    const user = userEvent.setup();
    const route = createRoute('HOTS Stake Race', '106');
    const searchCourses = vi.fn().mockResolvedValue([COURSES[1]]);
    const importCourseById = vi.fn().mockResolvedValue(route);
    const { onRouteImported } = renderWithServices({
      rownativeService: rownative({
        searchCourses,
        importCourseById,
        getCourseIndex: vi.fn().mockResolvedValue(COURSES),
      }),
      routeService: noExisting,
    });

    await open(user);
    await user.type(screen.getByLabelText(/search rownative courses by name/i), 'hots');
    await user.click(screen.getByRole('button', { name: /^search$/i }));

    expect(await screen.findByText('HOTS Stake Race')).toBeInTheDocument();
    expect(screen.getByText(/showing 1 of 2 courses/i)).toBeInTheDocument();
    expect(screen.getByText('4.80 km')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /HOTS Stake Race/i }));
    expect(importCourseById).toHaveBeenCalledWith('106');
    expect(onRouteImported).toHaveBeenCalledWith(route);
  });

  it('reports an empty search rather than showing a blank panel', async () => {
    const user = userEvent.setup();
    renderWithServices({
      rownativeService: rownative({
        searchCourses: vi.fn().mockResolvedValue([]),
        getCourseIndex: vi.fn().mockResolvedValue(COURSES),
      }),
    });

    await open(user);
    await user.type(screen.getByLabelText(/search rownative courses by name/i), 'zzzz');
    await user.click(screen.getByRole('button', { name: /^search$/i }));

    expect(await screen.findByText(/no courses match "zzzz"/i)).toBeInTheDocument();
  });

  it('surfaces a search failure', async () => {
    const user = userEvent.setup();
    renderWithServices({
      rownativeService: rownative({
        searchCourses: vi.fn().mockRejectedValue(new Error('Unable to load rownative course data (HTTP 500). Please try again.')),
        getCourseIndex: vi.fn().mockRejectedValue(new Error('Unable to load rownative course data (HTTP 500). Please try again.')),
      }),
    });

    await open(user);
    await user.click(screen.getByRole('button', { name: /^search$/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/HTTP 500/);
  });

  it('selects an already imported course rather than importing twice (AC-5)', async () => {
    const user = userEvent.setup();
    const existing = createRoute('Already Here');
    const importCourseById = vi.fn();
    const { onRouteImported } = renderWithServices({
      rownativeService: rownative({ importCourseById }),
      routeService: { ...defaultServices.routeService, findRouteByRownativeId: () => existing } satisfies Services['routeService'],
    });

    await open(user);
    await user.type(screen.getByLabelText(/rownative course id or link/i), '5');
    await user.click(screen.getByRole('button', { name: /^import$/i }));

    expect(importCourseById).not.toHaveBeenCalled();
    expect(onRouteImported).toHaveBeenCalledWith(existing);
    expect(await screen.findByRole('status')).toHaveTextContent(/already in your routes/i);
  });

  it('disables Import until something is entered', async () => {
    const user = userEvent.setup();
    renderWithServices();
    await open(user);

    expect(screen.getByRole('button', { name: /^import$/i })).toBeDisabled();
    await user.type(screen.getByLabelText(/rownative course id or link/i), '5');
    expect(screen.getByRole('button', { name: /^import$/i })).toBeEnabled();
  });
});
