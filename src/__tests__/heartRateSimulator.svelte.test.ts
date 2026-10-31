import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';

const mocks = vi.hoisted(() => {
  const state = { running: false };
  const hrListeners = new Map<string, Set<(s: unknown) => void>>();
  return {
    state,
    hrListeners,
    heartRateSimulator: {
      isRunning: vi.fn(() => state.running),
      getBpm: vi.fn(() => 130),
      setBpm: vi.fn(),
      start: vi.fn((_bpm?: number) => {
        state.running = true;
      }),
      stop: vi.fn(() => {
        state.running = false;
      }),
    },
    heartRateBluetoothService: {
      on: vi.fn((event: string, l: (s: unknown) => void) => {
        (hrListeners.get(event) ?? hrListeners.set(event, new Set()).get(event)!).add(l);
      }),
      off: vi.fn((event: string, l: (s: unknown) => void) => {
        hrListeners.get(event)?.delete(l);
      }),
    },
  };
});
const { state, hrListeners, heartRateSimulator } = mocks;
vi.mock('../lib/services/heartRateSimulatorService', () => ({
  heartRateSimulator: mocks.heartRateSimulator,
}));
vi.mock('../lib/services/heartRateBluetoothService', () => ({
  heartRateBluetoothService: mocks.heartRateBluetoothService,
}));

import HeartRateSimulator from '../lib/ui/HeartRateSimulator.svelte';

/** Heart-rate simulator (ported to Svelte for #542 P1). */
describe('HeartRateSimulator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.running = false;
    hrListeners.clear();
  });

  it('expands to reveal the Start control', async () => {
    render(HeartRateSimulator, {});
    await fireEvent.click(screen.getByText('HR Simulator'));
    expect(screen.getByText('▶ Start HR Simulator')).toBeTruthy();
  });

  it('starts the simulator at the chosen bpm', async () => {
    const onStarted = vi.fn();
    render(HeartRateSimulator, { onStarted });
    await fireEvent.click(screen.getByText('HR Simulator'));
    await fireEvent.click(screen.getByText('▶ Start HR Simulator'));
    expect(heartRateSimulator.start).toHaveBeenCalledWith(130);
    expect(onStarted).toHaveBeenCalled();
    expect(screen.getByText('ACTIVE')).toBeTruthy();
  });

  it('stops the simulator', async () => {
    const onStopped = vi.fn();
    render(HeartRateSimulator, { onStopped });
    await fireEvent.click(screen.getByText('HR Simulator'));
    await fireEvent.click(screen.getByText('▶ Start HR Simulator'));
    await fireEvent.click(screen.getByText('⏹ Stop'));
    expect(heartRateSimulator.stop).toHaveBeenCalled();
    expect(onStopped).toHaveBeenCalled();
  });

  it('pushes a target-bpm change through to the service', async () => {
    render(HeartRateSimulator, {});
    await fireEvent.click(screen.getByText('HR Simulator'));
    const [range] = screen.getAllByRole('slider');
    await fireEvent.input(range, { target: { value: '150' } });
    expect(heartRateSimulator.setBpm).toHaveBeenCalledWith(150);
  });

  it('shows the live bpm from the HR service while running', async () => {
    render(HeartRateSimulator, {});
    await fireEvent.click(screen.getByText('HR Simulator'));
    await fireEvent.click(screen.getByText('▶ Start HR Simulator'));
    hrListeners.get('heartRate')?.forEach((l) => l({ bpm: 142 }));
    expect(await screen.findByText('142 bpm')).toBeTruthy();
  });
});
