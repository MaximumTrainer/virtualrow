import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';

const mocks = vi.hoisted(() => {
  const listeners = new Set<(data: unknown) => void>();
  return {
    listeners,
    pm5Simulator: {
      start: vi.fn(),
      stop: vi.fn(),
      reset: vi.fn(),
      updateSettings: vi.fn(),
      addListener: vi.fn((l: (d: unknown) => void) => listeners.add(l)),
      removeListener: vi.fn((l: (d: unknown) => void) => listeners.delete(l)),
    },
  };
});
const { listeners, pm5Simulator } = mocks;
vi.mock('../lib/services/pm5SimulatorService', () => ({ pm5Simulator: mocks.pm5Simulator }));

import PM5Simulator from '../lib/ui/PM5Simulator.svelte';

/** PM5 simulator (ported to Svelte for #542 P1). */
describe('PM5Simulator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listeners.clear();
  });

  it('shows the collapsed header with the controls hidden', () => {
    render(PM5Simulator, {});
    expect(screen.getByText('PM5 Simulator')).toBeTruthy();
    expect(screen.queryByText('▶ Start Simulator')).toBeNull();
  });

  it('expands to reveal the Start control', async () => {
    render(PM5Simulator, {});
    await fireEvent.click(screen.getByText('PM5 Simulator'));
    expect(screen.getByText('▶ Start Simulator')).toBeTruthy();
  });

  it('starts the simulator rowing and reports the connection', async () => {
    const onConnected = vi.fn();
    render(PM5Simulator, { onConnected });
    await fireEvent.click(screen.getByText('PM5 Simulator'));
    await fireEvent.click(screen.getByText('▶ Start Simulator'));
    expect(pm5Simulator.start).toHaveBeenCalled();
    expect(pm5Simulator.updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({ isRowing: true }),
    );
    expect(onConnected).toHaveBeenCalledWith('PM5 Simulator');
    // The badge and the stop control appear once active.
    expect(screen.getByText('ACTIVE')).toBeTruthy();
    expect(screen.getByText('⏹ Stop')).toBeTruthy();
  });

  it('stops the simulator and reports the disconnect', async () => {
    const onDisconnected = vi.fn();
    render(PM5Simulator, { onDisconnected });
    await fireEvent.click(screen.getByText('PM5 Simulator'));
    await fireEvent.click(screen.getByText('▶ Start Simulator'));
    await fireEvent.click(screen.getByText('⏹ Stop'));
    expect(pm5Simulator.stop).toHaveBeenCalled();
    expect(onDisconnected).toHaveBeenCalled();
  });

  it('pushes a setting change through to the service while active', async () => {
    render(PM5Simulator, {});
    await fireEvent.click(screen.getByText('PM5 Simulator'));
    await fireEvent.click(screen.getByText('▶ Start Simulator'));
    pm5Simulator.updateSettings.mockClear();
    const [paceRange] = screen.getAllByRole('slider');
    await fireEvent.input(paceRange, { target: { value: '140' } });
    expect(pm5Simulator.updateSettings).toHaveBeenCalledWith({ pace: 140 });
  });

  it('forwards a frame from the service to onDataReceived', () => {
    const onDataReceived = vi.fn();
    render(PM5Simulator, { onDataReceived });
    const frame = { pace: 120, distance: 10 };
    listeners.forEach((l) => l(frame));
    expect(onDataReceived).toHaveBeenCalledWith(frame);
  });
});
