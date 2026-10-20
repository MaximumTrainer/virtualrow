import { afterAll, beforeAll, afterEach, describe, it, expect } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../App';
import { installCanvasMock } from './canvasMock';

/**
 * #505 Phase 2e (D6-c): the Routes screen is map-primary and the catalogue
 * slides in from the right.
 */

let uninstallCanvas: () => void;

beforeAll(() => {
  uninstallCanvas = installCanvasMock();
});

afterAll(() => {
  uninstallCanvas();
});

afterEach(() => cleanup());

describe('Routes drawer toggle (D6-c)', () => {
  it('renders the drawer toggle on the Routes screen', async () => {
    render(<App />);
    const user = userEvent.setup();
    // Go to the Routes screen (header nav has a "Routes" entry).
    await user.click(screen.getByRole('button', { name: /^routes$/i }));
    const toggle = await screen.findByTestId('routes-drawer-toggle');
    expect(toggle.textContent).toMatch(/show list/i);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
  });

  it('flips `data-drawer-open` and the toggle label when clicked', async () => {
    render(<App />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /^routes$/i }));
    const toggle = await screen.findByTestId('routes-drawer-toggle');
    const screenEl = toggle.closest('.route-search-screen');
    expect(screenEl).not.toBeNull();
    expect(screenEl?.getAttribute('data-drawer-open')).toBe('false');
    await user.click(toggle);
    expect(screenEl?.getAttribute('data-drawer-open')).toBe('true');
    expect(toggle.textContent).toMatch(/hide list/i);
  });
});
