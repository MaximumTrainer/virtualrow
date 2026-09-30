import { afterAll, afterEach, beforeAll, beforeEach, describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../App';
import * as UseAuth from '../context/useAuth';
import type { AuthContextValue } from '../context/useAuth';
import { installCanvasMock } from './canvasMock';
import {
  debugPreferencesStore,
  SHOW_DEMO_CTA_KEY,
} from '../services/debugPreferencesStore';
import { workoutService } from '../services/workoutService';
import { pm5Simulator } from '../services/pm5SimulatorService';
import { heartRateSimulator } from '../services/heartRateSimulatorService';

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

function mockSignedIn() {
  vi.spyOn(UseAuth, 'useAuth').mockReturnValue(signedIn());
}

beforeEach(() => {
  localStorage.clear();
  // Playwright is off by default in Vitest — that is the whole point of #453:
  // a real signed-in athlete does NOT see the CTA on a fresh browser.
  delete (window as unknown as { __PLAYWRIGHT_TESTING?: boolean }).__PLAYWRIGHT_TESTING;
});

afterEach(() => {
  // Same cleanup as appNavigation.test.tsx (see its comment): the demo-mode
  // simulators are module singletons that survive unmount.
  pm5Simulator.stop();
  heartRateSimulator.stop();
  if (workoutService.getCurrentSession()) workoutService.endSession();
  delete (window as unknown as { __PLAYWRIGHT_TESTING?: boolean }).__PLAYWRIGHT_TESTING;
  vi.restoreAllMocks();
});

/**
 * Issue #453 — the demo-row CTA is noise for signed-in athletes and a
 * foot-gun for the ones who tap it by mistake, so it is now hidden on the
 * main flow for them and toggled back on from the debug panel.
 */
describe('Demo-row CTA visibility (#453)', () => {
  it('AC1 (FR1): hides the CTA for a signed-in athlete on a fresh browser', () => {
    mockSignedIn();
    const { container } = render(<App />);
    expect(container.querySelector('.demo-row-cta')).toBeNull();
    expect(
      screen.queryByRole('button', { name: /Try a demo row/i }),
    ).not.toBeInTheDocument();
  });

  it('AC1 (FR2): still shows the CTA for a guest / signed-out visitor', () => {
    const { container } = render(<App />);
    expect(container.querySelector('.demo-row-cta')).not.toBeNull();
    expect(
      screen.getByRole('button', { name: /Try a demo row/i }),
    ).toBeInTheDocument();
  });

  it('AC6 (FR7): shows the CTA under Playwright even when signed in and the override is off', () => {
    (window as unknown as { __PLAYWRIGHT_TESTING?: boolean }).__PLAYWRIGHT_TESTING = true;
    mockSignedIn();
    const { container } = render(<App />);
    expect(container.querySelector('.demo-row-cta')).not.toBeNull();
  });

  it('AC1 (FR4): honours the persisted override on first render (signed in)', () => {
    debugPreferencesStore.setShowDemoCtaOverride(true);
    mockSignedIn();
    const { container } = render(<App />);
    expect(container.querySelector('.demo-row-cta')).not.toBeNull();
  });

  it('AC2 (FR3, FR4): toggling the debug-panel checkbox flips the CTA and localStorage', async () => {
    mockSignedIn();
    const user = userEvent.setup();
    const { container } = render(<App />);

    // Starts hidden.
    expect(container.querySelector('.demo-row-cta')).toBeNull();

    // Open debug panel.
    await user.click(screen.getByRole('button', { name: /Debug/i }));

    const toggle = screen.getByRole('checkbox', {
      name: /Show demo-row control on the main screen \(signed in\)/i,
    });
    expect(toggle).not.toBeChecked();

    // Check → CTA renders and the persisted key flips true.
    await user.click(toggle);
    expect(container.querySelector('.demo-row-cta')).not.toBeNull();
    expect(localStorage.getItem(SHOW_DEMO_CTA_KEY)).toBe('true');

    // Uncheck → CTA disappears and the persisted key flips false.
    await user.click(toggle);
    expect(container.querySelector('.demo-row-cta')).toBeNull();
    expect(localStorage.getItem(SHOW_DEMO_CTA_KEY)).toBe('false');
  });

  it('AC5 (FR6): the debug panel has a "Session" section above "PM5 Simulator"', async () => {
    mockSignedIn();
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: /Debug/i }));

    const sessionHeading = screen.getByRole('heading', { name: /^Session$/, level: 5 });
    const pm5Heading = screen.getByRole('heading', { name: /^PM5 Simulator$/, level: 5 });
    // Compare document order — the Session section must land above PM5.
    expect(
      sessionHeading.compareDocumentPosition(pm5Heading) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    // The Session section carries the checkbox and it lives in a
    // `.debug-section` container using the shared `.debug-toggle-row` shape.
    const sectionContainer = sessionHeading.closest('.debug-section');
    expect(sectionContainer).not.toBeNull();
    expect(sectionContainer?.querySelector('.debug-toggle-row')).not.toBeNull();
  });
});
