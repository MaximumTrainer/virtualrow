import { render, fireEvent } from '@testing-library/svelte';
import { tick } from 'svelte';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import HeartRateMonitorHarness from './fixtures/HeartRateMonitorHarness.svelte';

const { fake } = vi.hoisted(() => {
  const listeners = new Map<string, Set<(d: unknown) => void>>();
  const samples: { bpm: number }[] = [];
  return {
    fake: {
      listeners,
      samples,
      on(e: string, fn: (d: unknown) => void) {
        if (!listeners.has(e)) listeners.set(e, new Set());
        listeners.get(e)!.add(fn);
      },
      off(e: string, fn: (d: unknown) => void) {
        listeners.get(e)?.delete(fn);
      },
      emit(e: string, d?: unknown) {
        listeners.get(e)?.forEach((fn) => fn(d));
      },
      getSamples: () => samples,
      connect: vi.fn(async () => {}),
      disconnect: vi.fn(async () => {}),
    },
  };
});

vi.mock('../lib/services/heartRateBluetoothService', () => ({
  heartRateBluetoothService: fake,
}));

import HeartRateMonitor from '../lib/ui/HeartRateMonitor.svelte';

// #542 P1: HeartRateMonitor ported to Svelte, same DOM/classes the specs use.
describe('HeartRateMonitor.svelte', () => {
  beforeEach(() => {
    fake.listeners.clear();
    fake.samples.length = 0;
    fake.connect.mockClear();
    fake.disconnect.mockClear();
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('renders the disconnected panel with placeholder metrics', () => {
    const { container } = render(HeartRateMonitor);
    expect(container.querySelector('.device-name')?.textContent).toBe('Heart Rate Monitor');
    expect(container.querySelector('.device-status.disconnected')?.textContent?.trim()).toBe(
      'Disconnected',
    );
    const values = Array.from(container.querySelectorAll('.metric-value')).map((n) =>
      n.textContent,
    );
    expect(values).toEqual(['--', '--', '--']);
  });

  it('connects via the service', async () => {
    const { container } = render(HeartRateMonitor);
    await fireEvent.click(container.querySelector('.btn-connect')!);
    expect(fake.connect).toHaveBeenCalledTimes(1);
  });

  it('fires onSample synchronously and updates the current/avg/max readout', async () => {
    const onSample = vi.fn();
    const { container } = render(HeartRateMonitor, { onSample });

    fake.samples.push({ bpm: 120 }, { bpm: 140 });
    fake.emit('heartRate', { bpm: 140 });
    expect(onSample).toHaveBeenCalledWith(140); // synchronous, before any flush
    await tick();

    const values = Array.from(container.querySelectorAll('.metric-value')).map((n) =>
      n.textContent,
    );
    expect(values).toEqual(['140', '130', '140']); // current, avg, max
  });

  it('fires onConnected / onDisconnected on the service events', async () => {
    const onConnected = vi.fn();
    const onDisconnected = vi.fn();
    const { container } = render(HeartRateMonitor, { onConnected, onDisconnected });

    fake.emit('connected');
    await tick();
    expect(onConnected).toHaveBeenCalledTimes(1);
    expect(container.querySelector('.device-status.connected')).not.toBeNull();

    fake.emit('disconnected');
    await tick();
    expect(onDisconnected).toHaveBeenCalledTimes(1);
  });

  it('surfaces an error event', async () => {
    const { container } = render(HeartRateMonitor);
    fake.emit('error', new Error('hr dropped'));
    await tick();
    expect(container.querySelector('.error-message')?.textContent).toContain('hr dropped');
  });

  it('keeps props reactive through a harness wrapper', async () => {
    // Guards that destructured callback props read live values when invoked.
    const onSample = vi.fn();
    render(HeartRateMonitorHarness, { onSample });
    fake.emit('heartRate', { bpm: 150 });
    expect(onSample).toHaveBeenCalledWith(150);
  });

  it('sets the current bpm but leaves avg/max blank with no stored samples', async () => {
    const { container } = render(HeartRateMonitor);
    // getSamples() returns the empty fake.samples, so the avg/max branch is skipped.
    fake.emit('heartRate', { bpm: 132 });
    await tick();
    const values = Array.from(container.querySelectorAll('.metric-value')).map((n) => n.textContent);
    expect(values).toEqual(['132', '--', '--']);
  });

  it('stringifies a non-Error error event', async () => {
    const { container } = render(HeartRateMonitor);
    fake.emit('error', 'sensor lost');
    await tick();
    expect(container.querySelector('.error-message')?.textContent).toContain('sensor lost');
  });

  it('falls back to a generic message for an empty error', async () => {
    const { container } = render(HeartRateMonitor);
    fake.emit('error', '');
    await tick();
    expect(container.querySelector('.error-message')?.textContent).toContain('HR error');
  });

  it('disconnects from the disconnect button once connected', async () => {
    const { container } = render(HeartRateMonitor);
    fake.emit('connected');
    await tick();
    await fireEvent.click(container.querySelector('.btn-disconnect')!);
    expect(fake.disconnect).toHaveBeenCalledTimes(1);
  });

  it('removes its listeners on unmount', () => {
    const { unmount } = render(HeartRateMonitor);
    expect(fake.listeners.get('heartRate')?.size).toBe(1);
    unmount();
    expect(fake.listeners.get('heartRate')?.size ?? 0).toBe(0);
  });
});
