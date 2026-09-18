import { afterAll, afterEach, beforeAll, beforeEach, describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../App';
import { installCanvasMock } from './canvasMock';
import { workoutService } from '../services/workoutService';
import { pm5Simulator } from '../services/pm5SimulatorService';
import { heartRateSimulator } from '../services/heartRateSimulatorService';

/**
 * Debug has to be switchable from inside the debug window, not only from the
 * floating button that opens it (#270).
 *
 * The close control existed and nothing asserted it: responsive.spec.ts clicks
 * it as a step on the way to something else and never checks the panel
 * actually closed. A control that silently stopped working would have been
 * invisible.
 */
let uninstallCanvas: () => void;
beforeAll(() => {
  uninstallCanvas = installCanvasMock();
});
afterAll(() => uninstallCanvas());

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  pm5Simulator.stop();
  heartRateSimulator.stop();
  if (workoutService.getCurrentSession()) workoutService.endSession();
  vi.restoreAllMocks();
});

describe('the debug window', () => {
  it('is closed until asked for', () => {
    render(<App />);

    expect(document.querySelector('.debug-info-panel')).toBeNull();
  });

  it('opens from the floating control and closes from inside itself', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: /debug/i }));
    expect(document.querySelector('.debug-info-panel')).not.toBeNull();

    // The control inside the window, not the one that opened it.
    const panel = document.querySelector('.debug-info-panel') as HTMLElement;
    const closeButton = panel.querySelector('.debug-close-btn') as HTMLButtonElement;
    expect(closeButton, 'the debug window has no control of its own').not.toBeNull();

    await user.click(closeButton);

    expect(document.querySelector('.debug-info-panel')).toBeNull();
  });

  it('can be reopened after being closed from inside', async () => {
    const user = userEvent.setup();
    render(<App />);

    const toggle = screen.getByRole('button', { name: /debug/i });
    await user.click(toggle);
    const closeButton = document.querySelector('.debug-close-btn') as HTMLButtonElement;
    await user.click(closeButton);
    await user.click(toggle);

    expect(document.querySelector('.debug-info-panel')).not.toBeNull();
  });
});

describe('the river guides toggle', () => {
  it('offers a control for the guides inside the debug window', async () => {
    // The guides were gated on debugMode alone, so they arrived with every
    // other debug overlay and could not be turned off on their own (#270).
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: /debug/i }));

    const guides = screen.getByRole('checkbox', { name: /river guides/i });
    expect(guides).toBeTruthy();
    expect((guides as HTMLInputElement).checked).toBe(true);
  });

  it('remembers being switched off while the window stays open', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: /debug/i }));
    const guides = screen.getByRole('checkbox', { name: /river guides/i });

    await user.click(guides);

    expect((screen.getByRole('checkbox', { name: /river guides/i }) as HTMLInputElement).checked)
      .toBe(false);
  });
});

describe('the scenery kit toggle', () => {
  it('offers a control for the GLB scenery kit inside the debug window', async () => {
    // It replaced ?glb=, which was the only way to switch the kit and required
    // editing the URL to use (#270).
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: /debug/i }));

    expect(screen.getByRole('checkbox', { name: /scenery/i })).toBeTruthy();
  });

  it('switches the kit off and on again', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: /debug/i }));
    const kit = () => screen.getByRole('checkbox', { name: /scenery/i }) as HTMLInputElement;
    const started = kit().checked;

    await user.click(kit());
    expect(kit().checked).toBe(!started);

    await user.click(kit());
    expect(kit().checked).toBe(started);
  });
});
