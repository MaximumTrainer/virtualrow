import { afterAll, afterEach, beforeAll, beforeEach, describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../App';
import * as UseAuth from '../context/useAuth';
import type { AuthContextValue } from '../context/useAuth';
import { installCanvasMock } from './canvasMock';

let uninstallCanvas: () => void;
beforeAll(() => {
  uninstallCanvas = installCanvasMock();
});
afterAll(() => uninstallCanvas());

function signedIn(): AuthContextValue {
  return {
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
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * #454 Phase 1 — the Graphics picker is no longer part of the Row screen
 * furniture; it moved into the debug panel next to the debug-only session
 * and simulator controls, where a rower goes when they want to override
 * the probe (Phase 2 will teach the app to pick the tier from a runtime
 * measurement; the picker is the escape hatch for that decision).
 *
 * The picker's own DOM re-uses the shared `.graphics-quality` fieldset
 * class (CrewPicker does too), so location assertions target the picker
 * by its unique `role="radiogroup"` / `aria-label="Graphics quality"`.
 */
describe('Graphics picker location (#454 Phase 1)', () => {
  it('AC7 (FR6): the Row screen no longer renders the Graphics picker', () => {
    render(<App />);
    // Debug panel is not open on a fresh render, so the picker should be
    // nowhere in the DOM — the Row screen no longer carries one.
    expect(
      screen.queryByRole('radiogroup', { name: /Graphics quality/i }),
    ).not.toBeInTheDocument();
    // `.demo-row-cta`, `.conditions-picker` remain — the layout just
    // collapses where the picker was.
    expect(document.querySelector('.demo-row-cta')).not.toBeNull();
    expect(document.querySelector('.conditions-picker')).not.toBeNull();
  });

  it('AC7 (FR6): still no Graphics picker on the Row screen for signed-in athletes', () => {
    vi.spyOn(UseAuth, 'useAuth').mockReturnValue(signedIn());
    render(<App />);
    expect(
      screen.queryByRole('radiogroup', { name: /Graphics quality/i }),
    ).not.toBeInTheDocument();
  });

  it('AC5 (FR5): the debug panel carries a Graphics section beneath Session', async () => {
    vi.spyOn(UseAuth, 'useAuth').mockReturnValue(signedIn());
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: /Debug/i }));

    const graphicsHeading = screen.getByRole('heading', { name: /^Graphics$/, level: 5 });
    const sessionHeading = screen.getByRole('heading', { name: /^Session$/, level: 5 });
    // Session comes before Graphics in the panel.
    expect(
      sessionHeading.compareDocumentPosition(graphicsHeading) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    // The picker itself lives inside the Graphics `.debug-section`.
    const graphicsSection = graphicsHeading.closest('.debug-section');
    expect(graphicsSection).not.toBeNull();
    const picker = within(graphicsSection as HTMLElement).getByRole('radiogroup', {
      name: /Graphics quality/i,
    });
    expect(picker).toBeInTheDocument();

    // And exactly one Graphics-quality picker is present in the document
    // (regression guard against a stray render on the Row screen).
    expect(screen.getAllByRole('radiogroup', { name: /Graphics quality/i })).toHaveLength(1);
  });

  it('AC6 (FR5, D9): the picker keeps writing `virtualrow:graphics-quality`', async () => {
    vi.spyOn(UseAuth, 'useAuth').mockReturnValue(signedIn());
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: /Debug/i }));

    const picker = screen.getByRole('radiogroup', { name: /Graphics quality/i });
    await user.click(within(picker).getByRole('radio', { name: /^High$/ }));

    expect(localStorage.getItem('virtualrow:graphics-quality')).toBe('high');
  });
});
