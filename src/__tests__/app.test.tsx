import { afterAll, afterEach, beforeAll, describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../App';
import { formatPace } from '../utils/formatters';
import * as UseAuth from '../context/useAuth';
import type { AuthContextValue } from '../context/useAuth';
import { installCanvasMock } from './canvasMock';

let uninstallCanvas: () => void;

beforeAll(() => {
  uninstallCanvas = installCanvasMock();
});

afterAll(() => {
  uninstallCanvas();
});

describe('App component', () => {
  it('renders title, the selected route and the heart rate panel', () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: /VirtualRow/i })).toBeInTheDocument();
    // The Row screen shows one route — the list itself lives on the Routes
    // screen now (issue #219, R2).
    const matches = screen.getAllByText(/Willowbrook River/i);
    expect(matches.length).toBeGreaterThan(0);
    // Heart Rate panel title
    expect(screen.getByText(/Heart Rate/i)).toBeInTheDocument();
  });

  it('formats pace values for the activity screen', () => {
    expect(formatPace(null)).toBe('--:--');
    expect(formatPace(0)).toBe('--:--');
    expect(formatPace(125)).toBe('2:05/500m');
    expect(formatPace(359)).toBe('5:59/500m');
  });

  it('does not show Quick Start button', () => {
    render(<App />);
    expect(screen.queryByRole('button', { name: /Quick Start/i })).not.toBeInTheDocument();
  });

  it('does not show a History tab', () => {
    render(<App />);

    expect(screen.queryByRole('button', { name: /History/i })).not.toBeInTheDocument();
  });

  it('does not render the route description in the route details panel', () => {
    const { container } = render(<App />);

    expect(container.querySelector('.route-description')).toBeNull();
    expect(
      screen.queryByRole('button', { name: /(Collapse|Expand) route info/i }),
    ).not.toBeInTheDocument();
  });

  // ── Signed-out test drive (issue #187) ─────────────────────────────────

  it('pre-selects Willowbrook River for a signed-out visitor (TD-1)', () => {
    render(<App />);
    // The route panel heading carries the pre-selected route.
    expect(screen.getAllByText(/Willowbrook River/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/Willowbrook Valley/i)).toBeInTheDocument();
  });

  it('disables the start control and names the missing device (TD-1)', () => {
    render(<App />);
    const start = screen.getByRole('button', { name: /Connect PM5 First/i });
    expect(start).toBeDisabled();
  });

  it('names FTMS instead when FTMS is the selected rower type (TD-1)', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: /^FTMS$/ }));
    expect(screen.getByRole('button', { name: /Connect FTMS First/i })).toBeDisabled();
  });

  it('offers a plain-language demo row, not hidden behind Debug (TD-2)', () => {
    render(<App />);

    const demo = screen.getByRole('button', { name: /try a demo row/i });
    expect(demo).toBeInTheDocument();
    expect(demo).toBeEnabled();
    // It must be reachable without opening the developer debug panel.
    expect(demo.closest('.debug-info-panel')).toBeNull();
    expect(screen.getByText(/simulated rower and heart-rate data/i)).toBeInTheDocument();
  });

  it('states in visible copy that guest sessions are not saved (TD-3)', () => {
    const { container } = render(<App />);

    const notice = container.querySelector('.signed-out-notice');
    expect(notice).toBeInTheDocument();
    expect(notice).toHaveTextContent(/sessions are not saved/i);
  });

  it('offers a sign-in control on the routes view (TD-3)', () => {
    render(<App />);
    expect(screen.getByRole('button', { name: /sign in with intervals\.icu/i })).toBeInTheDocument();
  });

  it('shows Rower Device and Heart Rate panels for unauthenticated users without guest sidebar class', () => {
    const { container } = render(<App />);

    expect(screen.getByText(/Rower Device/i)).toBeInTheDocument();
    expect(screen.getByText(/Heart Rate/i)).toBeInTheDocument();
    // GUEST-2: sidebar must not carry app-sidebar--guest (which previously hid device panels)
    const sidebar = container.querySelector('.app-sidebar');
    expect(sidebar?.classList.contains('app-sidebar--guest')).toBe(false);
  });

  it('does not show the file import control for unauthenticated users', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: /^Routes$/ }));
    expect(screen.queryByRole('button', { name: /import a file/i })).not.toBeInTheDocument();
  });

  it('does not show rownative import for unauthenticated users', async () => {
    const user = userEvent.setup();
    render(<App />);

    // Absent on the Row screen and on the Routes screen alike.
    expect(screen.queryByRole('region', { name: /rownative course import/i })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^Routes$/ }));
    expect(screen.queryByRole('region', { name: /rownative course import/i })).not.toBeInTheDocument();
  });

  describe('authenticated user', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('shows the rownative import and file import on the Routes screen when logged in', async () => {
      const authedValue: AuthContextValue = {
        user: { id: 'i12345', name: 'Test User', email: 'test@example.com' },
        isAuthenticated: true,
        isLoading: false,
        authError: null,
        login: vi.fn(),
        logout: vi.fn(),
        clearAuthError: vi.fn(),
        pendingAction: null,
        setPendingAction: vi.fn(),
      };
      vi.spyOn(UseAuth, 'useAuth').mockReturnValue(authedValue);
      const user = userEvent.setup();

      render(<App />);
      await user.click(screen.getByRole('button', { name: /^Routes$/ }));

      expect(screen.getByRole('button', { name: /import a file/i })).toBeInTheDocument();
      expect(screen.getByRole('region', { name: /rownative course import/i })).toBeInTheDocument();
    });

    it('does not show a History tab when logged in', () => {
      const authedValue: AuthContextValue = {
        user: { id: 'i12345', name: 'Test User', email: 'test@example.com' },
        isAuthenticated: true,
        isLoading: false,
        authError: null,
        login: vi.fn(),
        logout: vi.fn(),
        clearAuthError: vi.fn(),
        pendingAction: null,
        setPendingAction: vi.fn(),
      };
      vi.spyOn(UseAuth, 'useAuth').mockReturnValue(authedValue);

      render(<App />);

      expect(screen.queryByRole('button', { name: /History/i })).not.toBeInTheDocument();
    });
  });
});

/**
 * Issue #338 — the pre-row choice, on the screen it belongs to.
 *
 * `ghostPicker.test.tsx` covers the control itself. These are about it being
 * wired to the route the rower is actually looking at: the best it offers to
 * race has to be a row on *this* route, kept for *this* athlete.
 */
describe('choosing what to race', () => {
  it('offers the choice on the route panel, before the row starts', () => {
    render(<App />);

    expect(screen.getByRole('group', { name: /row against/i })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /row alone/i })).toBeChecked();
  });

  // A visitor with no stored rows has nothing to race, and the option says so
  // rather than disappearing: the rower has done nothing wrong.
  it('cannot race a best that was never rowed, and says why', () => {
    render(<App />);

    expect(screen.getByRole('radio', { name: /my best/i })).toBeDisabled();
    expect(screen.getByText(/first row on this route/i)).toBeInTheDocument();
  });

  it('asks for a target pace once a pace boat is chosen', async () => {
    render(<App />);

    await userEvent.click(screen.getByRole('radio', { name: /pace boat/i }));

    expect(screen.getByLabelText(/target pace/i)).toHaveValue('2:00');
  });
});

/**
 * Issue #339 — the sound switch, on the screen it belongs to.
 *
 * `soundPicker.test.tsx` covers the control. This is about it being wired:
 * the switch is the user gesture a browser requires before any audio exists,
 * so if it is not connected to anything there is no other way to start sound.
 */
describe('switching the sound on', () => {
  it('offers the switch among the other settings, off to begin with', () => {
    render(<App />);

    expect(screen.getByRole('switch', { name: /sound/i })).not.toBeChecked();
    expect(screen.queryByRole('slider', { name: /volume/i })).toBeNull();
  });

  it('turns on, and offers a volume once there is something to hear', async () => {
    render(<App />);

    await userEvent.click(screen.getByRole('switch', { name: /sound/i }));

    expect(screen.getByRole('switch', { name: /sound/i })).toBeChecked();
    expect(screen.getByRole('slider', { name: /volume/i })).toBeInTheDocument();
  });
});
