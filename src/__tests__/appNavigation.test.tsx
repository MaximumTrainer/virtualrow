import { afterAll, afterEach, beforeAll, beforeEach, describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../App';
import * as UseAuth from '../context/useAuth';
import type { AuthContextValue } from '../context/useAuth';
import { installCanvasMock } from './canvasMock';
import {
  defaultRoutePreferenceStore,
  DEFAULT_ROUTE_KEY_PREFIX,
} from '../services/defaultRoutePreferenceStore';
import { workoutService } from '../services/workoutService';
import { pm5Simulator } from '../services/pm5SimulatorService';
import { heartRateSimulator } from '../services/heartRateSimulatorService';

let uninstallCanvas: () => void;
beforeAll(() => {
  uninstallCanvas = installCanvasMock();
});
afterAll(() => uninstallCanvas());

const ATHLETE_ID = 'i12345';

function signedIn(id = ATHLETE_ID): AuthContextValue {
  return {
    user: { id, name: 'Test User', email: 'test@example.com' },
    isAuthenticated: true,
    isLoading: false,
    authError: null,
    login: vi.fn(),
    logout: vi.fn(),
    clearAuthError: vi.fn(),
    pendingAction: null,
    setPendingAction: vi.fn(),
  };
}

function mockSignedIn(id = ATHLETE_ID) {
  vi.spyOn(UseAuth, 'useAuth').mockReturnValue(signedIn(id));
}

/** Walk to the Routes screen through the header nav, as a user would. */
async function goToRoutes(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: /^Routes$/ }));
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  // Starting a demo row starts two module-singleton simulators on real
  // intervals and opens a workout session. Unmounting the component does not
  // stop them, so left alone they leak into every later test — in this file and
  // in any other sharing the worker. The shuffled-order gate (#201) is what
  // turns that leak from an intermittent annoyance into a hard failure.
  pm5Simulator.stop();
  heartRateSimulator.stop();
  if (workoutService.getCurrentSession()) workoutService.endSession();
  vi.restoreAllMocks();
});

/* ==========================================================================
   R2 — the Row screen is decluttered around the demo route
   ========================================================================== */
describe('Row screen (issue #219, R2)', () => {
  it('AC2.1: carries no route-discovery clutter when signed out', () => {
    const { container } = render(<App />);

    expect(container.querySelector('.routes-list')).toBeNull();
    expect(container.querySelector('.route-filters')).toBeNull();
    expect(container.querySelector('.btn-import-route')).toBeNull();
    expect(container.querySelector('.route-import')).toBeNull();
    expect(container.querySelector('.rownative-import')).toBeNull();
  });

  it('AC2.1: carries no route-discovery clutter when signed in either', () => {
    mockSignedIn();
    const { container } = render(<App />);

    expect(container.querySelector('.routes-list')).toBeNull();
    expect(container.querySelector('.route-filters')).toBeNull();
    expect(container.querySelector('.btn-import-route')).toBeNull();
    expect(container.querySelector('.route-import')).toBeNull();
    expect(container.querySelector('.rownative-import')).toBeNull();
  });

  it('AC2.1: keeps exactly one primary action group — start and demo', () => {
    render(<App />);

    expect(screen.getByRole('button', { name: /Connect PM5 First/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /try a demo row/i })).toBeInTheDocument();
  });

  it('AC2.2: a Change route control opens the Routes screen', async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);

    await user.click(screen.getByRole('button', { name: /change route/i }));

    expect(container.querySelector('.view-container--search')).toBeInTheDocument();
    expect(container.querySelector('.view-container--routes')).toBeNull();
  });

  it('AC2.4: still shows the route location and distance in the hero', () => {
    render(<App />);

    expect(screen.getByText(/Willowbrook Valley/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Willowbrook River/i).length).toBeGreaterThan(0);
  });
});

/* ==========================================================================
   R3 — a second screen for route search and selection
   ========================================================================== */
describe('Routes screen (issue #219, R3)', () => {
  it('AC3.2: shows the rownative import, the route list and the file disclosure', async () => {
    mockSignedIn();
    const user = userEvent.setup();
    const { container } = render(<App />);

    await goToRoutes(user);

    expect(screen.getByRole('region', { name: /rownative course import/i })).toBeInTheDocument();
    expect(container.querySelector('.routes-list')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /import a file/i })).toBeInTheDocument();
  });

  it('AC3.2: puts the course-ID import ahead of the name search', async () => {
    mockSignedIn();
    const user = userEvent.setup();
    render(<App />);

    await goToRoutes(user);

    const region = screen.getByRole('region', { name: /rownative course import/i });
    const idField = within(region).getByLabelText(/course ID or link/i);
    const searchField = within(region).getByLabelText(/search rownative courses by name/i);

    // Node.DOCUMENT_POSITION_FOLLOWING === 4
    expect(idField.compareDocumentPosition(searchField) & 4).toBeTruthy();
  });

  it('AC3.4: choosing a route returns to the Row screen with it selected', async () => {
    mockSignedIn();
    const user = userEvent.setup();
    const { container } = render(<App />);

    await goToRoutes(user);
    await user.click(screen.getByRole('heading', { name: /Willowbrook River/i, level: 4 }));

    expect(container.querySelector('.view-container--routes')).toBeInTheDocument();
    expect(container.querySelector('.route-info-overlay h2')).toHaveTextContent('Willowbrook River');
  });

  it('AC3.5: the file input is absent until the disclosure is expanded', async () => {
    mockSignedIn();
    const user = userEvent.setup();
    const { container } = render(<App />);

    await goToRoutes(user);

    const disclosure = screen.getByRole('button', { name: /import a file/i });
    expect(disclosure).toHaveAttribute('aria-expanded', 'false');
    expect(container.querySelector('.route-import input[type="file"]')).toBeNull();

    await user.click(disclosure);

    expect(disclosure).toHaveAttribute('aria-expanded', 'true');
    expect(container.querySelector('.route-import input[type="file"]')).toBeInTheDocument();
  });

  it('AC3.6: Back to Row returns to the Row screen', async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);

    await goToRoutes(user);
    await user.click(screen.getByRole('button', { name: /back to row/i }));

    expect(container.querySelector('.view-container--routes')).toBeInTheDocument();
  });

  it('a signed-out visitor sees the route list but is told to sign in to import', async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);

    await goToRoutes(user);

    expect(container.querySelector('.routes-list')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: /rownative course import/i })).toBeNull();
    expect(screen.getByText(/sign in with intervals\.icu to import courses/i)).toBeInTheDocument();
  });
});

/* ==========================================================================
   R6 — default route, selectable once logged in
   ========================================================================== */
describe('default route (issue #219, R6)', () => {
  it('AC6.1: the Set as default control is signed-in only', async () => {
    const user = userEvent.setup();
    render(<App />);
    await goToRoutes(user);

    expect(screen.queryByRole('button', { name: /set as default/i })).toBeNull();
  });

  it('AC6.2: setting a default writes the athlete-scoped key', async () => {
    mockSignedIn();
    const user = userEvent.setup();
    render(<App />);

    await goToRoutes(user);
    await user.click(screen.getByRole('button', { name: /set as default/i }));

    expect(localStorage.getItem(`${DEFAULT_ROUTE_KEY_PREFIX}${ATHLETE_ID}`)).toBe('1');
    expect(screen.getByRole('button', { name: /remove as default/i })).toBeInTheDocument();
  });

  it('AC6.3: a stored default is pre-selected on the next load', () => {
    defaultRoutePreferenceStore.setDefaultRouteId(ATHLETE_ID, '1');
    mockSignedIn();

    const { container } = render(<App />);

    expect(container.querySelector('.route-info-overlay h2')).toHaveTextContent('Willowbrook River');
  });

  it('AC6.4: a stored id that no longer resolves falls back and is cleared', () => {
    defaultRoutePreferenceStore.setDefaultRouteId(ATHLETE_ID, 'no-such-route');
    mockSignedIn();

    const { container } = render(<App />);

    expect(container.querySelector('.route-info-overlay h2')).toHaveTextContent('Willowbrook River');
    expect(defaultRoutePreferenceStore.getDefaultRouteId(ATHLETE_ID)).toBeNull();
  });

  it('AC6.6: un-starring clears the stored default', async () => {
    defaultRoutePreferenceStore.setDefaultRouteId(ATHLETE_ID, '1');
    mockSignedIn();
    const user = userEvent.setup();
    render(<App />);

    await goToRoutes(user);
    await user.click(screen.getByRole('button', { name: /remove as default/i }));

    expect(defaultRoutePreferenceStore.getDefaultRouteId(ATHLETE_ID)).toBeNull();
    expect(screen.getByRole('button', { name: /set as default/i })).toBeInTheDocument();
  });

  it('AC6.9: one athlete does not inherit another athlete default', () => {
    defaultRoutePreferenceStore.setDefaultRouteId('i99999', 'no-such-route');
    mockSignedIn(ATHLETE_ID);

    render(<App />);

    // i99999's stale key is untouched — it was never read for this athlete.
    expect(defaultRoutePreferenceStore.getDefaultRouteId('i99999')).toBe('no-such-route');
  });

  it('AC6.7: a signed-out visitor still lands on Willowbrook', () => {
    const { container } = render(<App />);

    expect(container.querySelector('.route-info-overlay h2')).toHaveTextContent('Willowbrook River');
  });
});

/* ==========================================================================
   R7 — the demo row
   ========================================================================== */
describe('demo row (issue #219, R7)', () => {
  it('AC7.1: is one click from first paint', () => {
    render(<App />);

    const demo = screen.getByRole('button', { name: /try a demo row/i });
    expect(demo).toBeEnabled();
    expect(demo.closest('.debug-info-panel')).toBeNull();
  });

  it('AC7.2: is offered to signed-in users too', () => {
    mockSignedIn();
    render(<App />);

    expect(screen.getByRole('button', { name: /try a demo row/i })).toBeEnabled();
  });
});

/* ==========================================================================
   R8 — navigation
   ========================================================================== */
describe('header navigation (issue #219, R8)', () => {
  it('AC8.1: exposes Row and Routes', () => {
    render(<App />);

    expect(screen.getByRole('button', { name: /^Row$/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Routes$/ })).toBeInTheDocument();
  });

  it('AC8.2: marks the active screen with aria-current', async () => {
    const user = userEvent.setup();
    render(<App />);

    expect(screen.getByRole('button', { name: /^Row$/ })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: /^Routes$/ })).not.toHaveAttribute('aria-current');

    await goToRoutes(user);

    expect(screen.getByRole('button', { name: /^Routes$/ })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: /^Row$/ })).not.toHaveAttribute('aria-current');
  });

  it('AC8.3: the hamburger reports its state and controls the overlay', () => {
    render(<App />);

    const toggle = screen.getByRole('button', { name: 'Menu' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveAttribute('aria-controls', 'nav-overlay');
  });

  it('AC8.4: the nav is hidden during an active workout', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: /try a demo row/i }));

    expect(screen.queryByRole('button', { name: /^Routes$/ })).toBeNull();
  });
});
