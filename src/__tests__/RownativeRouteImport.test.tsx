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
      // Spreading a class instance copies its fields, not its prototype
      // methods, so every method a call-site reaches has to be named here.
      // `satisfies` does not catch it: the spread's *type* carries the methods
      // even though the value does not.
      ...defaultServices.rownativeService,
      resolveCourseId: realResolve,
      attachedTrack: () => null,
      ...overrides,
    } satisfies Services['rownativeService'];
  }

  const noExisting = { ...defaultServices.routeService, findRouteByRownativeId: () => undefined } satisfies Services['routeService'];

  it('offers no account-linking controls at all', () => {
    renderWithServices();

    expect(screen.queryByRole('button', { name: /link rownative account/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /complete linking/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /unlink/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /pull route kml/i })).toBeNull();
  });

  it('imports a pasted course id (AC-1)', async () => {
    const user = userEvent.setup();
    const route = createRoute();
    const importCourseById = vi.fn().mockResolvedValue(route);
    const { onRouteImported } = renderWithServices({
      rownativeService: rownative({ importCourseById }),
      routeService: noExisting,
    });


    await user.type(screen.getByLabelText(/rownative course id or link/i), '5');
    await user.click(screen.getByRole('button', { name: /^import$/i }));

    expect(importCourseById).toHaveBeenCalledWith('5');
    expect(onRouteImported).toHaveBeenCalledWith(route);
  });

  it('imports a pasted rownative.icu course link (AC-1)', async () => {
    const user = userEvent.setup();
    const importCourseById = vi.fn().mockResolvedValue(createRoute());
    renderWithServices({ rownativeService: rownative({ importCourseById }), routeService: noExisting });


    await user.type(screen.getByLabelText(/rownative course id or link/i), 'https://rownative.icu/course/5');
    await user.click(screen.getByRole('button', { name: /^import$/i }));

    expect(importCourseById).toHaveBeenCalledWith('5');
  });

  it('rejects a foreign host client-side, making no request (AC-4)', async () => {
    const user = userEvent.setup();
    const importCourseById = vi.fn();
    renderWithServices({ rownativeService: rownative({ importCourseById }) });


    await user.type(screen.getByLabelText(/rownative course id or link/i), 'https://evil.example/course/5');
    await user.click(screen.getByRole('button', { name: /^import$/i }));

    expect(importCourseById).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toMatch(/https:\/\/ links on rownative\.icu/i);
  });

  it('rejects an http link client-side, making no request (AC-4)', async () => {
    const user = userEvent.setup();
    const importCourseById = vi.fn();
    renderWithServices({ rownativeService: rownative({ importCourseById }) });


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


    await user.type(screen.getByLabelText(/rownative course id or link/i), '5');
    await user.click(screen.getByRole('button', { name: /^import$/i }));

    expect(importCourseById).not.toHaveBeenCalled();
    expect(onRouteImported).toHaveBeenCalledWith(existing);
    expect(await screen.findByRole('status')).toHaveTextContent(/already in your routes/i);
  });

  it('disables Import until something is entered', async () => {
    const user = userEvent.setup();
    renderWithServices();


    expect(screen.getByRole('button', { name: /^import$/i })).toBeDisabled();
    await user.type(screen.getByLabelText(/rownative course id or link/i), '5');
    expect(screen.getByRole('button', { name: /^import$/i })).toBeEnabled();
  });
});

/**
 * Attaching a track, through the UI (#313).
 *
 * The service half of this shipped with #206 and had no entrance: nothing under
 * src/components imported trackAttachmentStore, and the E2E that covered it
 * wrote the attachment straight into localStorage with a comment saying it was
 * "seeded the way a previous session would have left it" — which no session
 * could do. These drive the control a rower actually uses.
 */
describe('RownativeRouteImport — attaching a track', () => {
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
      // Spreading a class instance copies its fields, not its prototype
      // methods, so every method a call-site reaches has to be named here.
      // `satisfies` does not catch it: the spread's *type* carries the methods
      // even though the value does not.
      ...defaultServices.rownativeService,
      resolveCourseId: realResolve,
      attachedTrack: () => null,
      ...overrides,
    } satisfies Services['rownativeService'];
  }

  const noExisting = {
    ...defaultServices.routeService,
    findRouteByRownativeId: () => undefined,
  } satisfies Services['routeService'];

  const trackFile = () =>
    new File(
      [JSON.stringify({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: [[-4.56, 55.93], [-4.28, 55.85]] },
      })],
      'clyde.geojson',
      { type: 'application/geo+json' },
    );

  /** Search, so the result list with its attach controls is on screen. */
  async function showResults(overrides: Record<string, unknown>) {
    const user = userEvent.setup();
    const result = renderWithServices({
      rownativeService: rownative({
        searchCourses: vi.fn().mockResolvedValue([COURSES[0]]),
        getCourseIndex: vi.fn().mockResolvedValue(COURSES),
        ...overrides,
      }),
      routeService: noExisting,
    });
    await user.click(screen.getByRole('button', { name: /^search$/i }));
    await screen.findByText(/showing 1 of 2 courses/i);
    return { user, ...result };
  }

  it('offers an attach control on every course', async () => {
    await showResults({ attachedTrack: () => null });

    expect(screen.getByLabelText(/attach a track to Quinsig S to N/i)).toBeInTheDocument();
  });

  it('attaches a chosen file and hands back the re-imported route', async () => {
    const route = createRoute();
    const attachTrack = vi.fn().mockResolvedValue({
      track: { courseId: '5', fileName: 'clyde.geojson', attachedAt: 1, coordinates: [] },
      route,
    });
    const { user, onRouteImported } = await showResults({ attachTrack, attachedTrack: () => null });

    await user.upload(screen.getByLabelText(/attach a track to Quinsig S to N/i), trackFile());

    expect(attachTrack).toHaveBeenCalledWith('5', 'clyde.geojson', expect.stringContaining('LineString'));
    expect(onRouteImported).toHaveBeenCalledWith(route);
    expect(await screen.findByText(/clyde\.geojson attached/i)).toBeInTheDocument();
  });

  it('shows why a track was refused, in the words the check used', async () => {
    // The gate check names the gate and the offset. Replacing that with
    // "could not attach" would throw away the only useful part.
    const attachTrack = vi.fn().mockRejectedValue(
      new Error('This track passes 1,350 m from the "WP5" gate, more than the 40 m allowed.'),
    );
    const { user, onRouteImported } = await showResults({ attachTrack, attachedTrack: () => null });

    await user.upload(screen.getByLabelText(/attach a track to Quinsig S to N/i), trackFile());

    expect(await screen.findByRole('alert')).toHaveTextContent(/1,350 m from the "WP5" gate/);
    expect(onRouteImported, 'a refused track still changed the route').not.toHaveBeenCalled();
  });

  it('shows what is attached, and can remove it', async () => {
    const route = createRoute();
    const detachTrack = vi.fn().mockResolvedValue(route);
    const { user, onRouteImported } = await showResults({
      detachTrack,
      attachedTrack: (id: string) => (id === '5' ? { courseId: '5', fileName: 'clyde.gpx', attachedAt: 1, coordinates: [] } : null),
    });

    expect(screen.getByText('clyde.gpx')).toBeInTheDocument();
    // The control says what it will do to a course that already has one.
    expect(screen.getByText(/replace track/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /remove the track attached to Quinsig S to N/i }));

    expect(detachTrack).toHaveBeenCalledWith('5');
    expect(onRouteImported).toHaveBeenCalledWith(route);
  });

  it('offers no remove control for a course with nothing attached', async () => {
    await showResults({ attachedTrack: () => null });

    expect(screen.queryByRole('button', { name: /remove the track/i })).toBeNull();
    expect(screen.getByText(/attach track/i)).toBeInTheDocument();
  });
});
