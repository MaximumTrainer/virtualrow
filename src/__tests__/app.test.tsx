import { afterAll, afterEach, beforeAll, describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../App';
import { formatPace } from '../utils/formatters';
import * as UseAuth from '../context/useAuth';
import type { AuthContextValue } from '../context/useAuth';

const originalGetContext = HTMLCanvasElement.prototype.getContext;

beforeAll(() => {
  const gradient = { addColorStop: vi.fn() };
  const baseContext = {
    canvas: document.createElement('canvas'),
    getExtension: vi.fn(),
    createShader: vi.fn(),
    createProgram: vi.fn(),
    shaderSource: vi.fn(),
    compileShader: vi.fn(),
    attachShader: vi.fn(),
    linkProgram: vi.fn(),
    useProgram: vi.fn(),
    getShaderParameter: vi.fn(() => true),
    getProgramParameter: vi.fn(() => true),
    getShaderInfoLog: vi.fn(() => ''),
    getProgramInfoLog: vi.fn(() => ''),
    viewport: vi.fn(),
    clearColor: vi.fn(),
    clear: vi.fn(),
    createLinearGradient: vi.fn(() => gradient),
    createRadialGradient: vi.fn(() => gradient),
  };
  // RouteMap uses a broad Canvas2D API surface; unknown members become no-op spies
  // so jsdom can render App without requiring a full canvas implementation.
  const context = new Proxy(baseContext as Record<string, unknown>, {
    get(target, prop) {
      if (!(prop in target)) target[prop as string] = vi.fn();
      return target[prop as string];
    },
  });
  HTMLCanvasElement.prototype.getContext = vi.fn(
    ((contextType: string) => {
      if (contextType === '2d') {
        return context as unknown as CanvasRenderingContext2D;
      }
      return null;
    }) as typeof HTMLCanvasElement.prototype.getContext,
  ) as unknown as typeof HTMLCanvasElement.prototype.getContext;
});

afterAll(() => {
  HTMLCanvasElement.prototype.getContext = originalGetContext;
});

describe('App component', () => {
  it('renders title, routes list, and heart rate panel', () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: /VirtualRow/i })).toBeInTheDocument();
    // Check Willowbrook River route appears (the only route now)
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

  it('shows route-only navigation (no History tab)', () => {
    render(<App />);

    expect(screen.getByRole('button', { name: /Routes/i })).toBeInTheDocument();
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

  it('does not show Import Route button for unauthenticated users', () => {
    render(<App />);
    expect(screen.queryByRole('button', { name: /Import Route/i })).not.toBeInTheDocument();
  });

  it('does not show Open rownative.icu button for unauthenticated users', () => {
    render(<App />);
    expect(screen.queryByRole('button', { name: /rownative\.icu/i })).not.toBeInTheDocument();
  });

  describe('authenticated user', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('shows Import Route and Open rownative.icu buttons when logged in', () => {
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

      expect(screen.getByRole('button', { name: /Import Route/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /rownative\.icu/i })).toBeInTheDocument();
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
