import { render, fireEvent } from '@testing-library/svelte';
import { tick } from 'svelte';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { fake } = vi.hoisted(() => {
  const listeners = new Map<string, Set<(d: unknown) => void>>();
  return {
    fake: {
      listeners,
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
      connect: vi.fn(async () => true),
      disconnect: vi.fn(async () => {}),
    },
  };
});

vi.mock('../lib/services/ftmsBluetoothService', () => ({ ftmsBluetoothService: fake }));

import FTMSDevice from '../lib/ui/FTMSDevice.svelte';

// #542 P1: FTMSDevice ported to Svelte, same DOM/classes the specs use.
describe('FTMSDevice.svelte', () => {
  beforeEach(() => {
    fake.listeners.clear();
    fake.connect.mockClear();
    fake.disconnect.mockClear();
    fake.connect.mockResolvedValue(true);
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('renders the disconnected FTMS panel with its connect button and note', () => {
    const { container } = render(FTMSDevice);
    expect(container.querySelector('.device-name')?.textContent).toBe('FTMS Rower');
    expect(container.querySelector('.btn-connect')?.textContent?.trim()).toBe(
      'Connect FTMS Rower',
    );
    expect(container.querySelector('.device-note')?.textContent).toContain(
      'FTMS-compatible rowing machine',
    );
  });

  it('connects and shows the device name from the event', async () => {
    const { container } = render(FTMSDevice);
    await fireEvent.click(container.querySelector('.btn-connect')!);
    expect(fake.connect).toHaveBeenCalledTimes(1);

    fake.emit('connected', { deviceName: 'WaterRower' });
    await tick();
    expect(container.querySelector('.device-name')?.textContent).toBe('WaterRower');
    expect(container.querySelector('.device-status.connected')).not.toBeNull();
  });

  it('shows the FTMS Rate metric (not Cadence) for non-zero cadence', async () => {
    const { container } = render(FTMSDevice);
    fake.emit('data', { pace: 118, distance: 1000, elapsedTime: 60, cadence: 24 });
    await tick();
    const labels = Array.from(container.querySelectorAll('.metric-label')).map((n) =>
      n.textContent,
    );
    expect(labels).toContain('Rate');
    expect(labels).not.toContain('Cadence');
  });

  it('falls back to "FTMS Rower" when the connected event carries no name', async () => {
    const { container } = render(FTMSDevice);
    fake.emit('connected', {});
    await tick();
    expect(container.querySelector('.device-name')?.textContent).toBe('FTMS Rower');
    expect(container.querySelector('.device-status.connected')).not.toBeNull();
  });

  it('re-enables the connect button when connect() resolves false', async () => {
    fake.connect.mockResolvedValue(false);
    const { container } = render(FTMSDevice);
    await fireEvent.click(container.querySelector('.btn-connect')!);
    await tick();
    const btn = container.querySelector('.btn-connect') as HTMLButtonElement;
    expect(btn).not.toBeNull();
    expect(btn.disabled).toBe(false);
  });

  it('disconnects from the disconnect button once connected', async () => {
    const { container } = render(FTMSDevice);
    fake.emit('connected', { deviceName: 'WaterRower' });
    await tick();
    await fireEvent.click(container.querySelector('.btn-disconnect')!);
    expect(fake.disconnect).toHaveBeenCalledTimes(1);
  });

  it('shows power / HR, a "--" pace and an hours-long time', async () => {
    const { container } = render(FTMSDevice);
    fake.emit('data', {
      pace: 0,
      distance: 2000,
      elapsedTime: 3700, // seconds → hours branch of formatTime
      power: 150,
      cadence: 22,
      heartRate: 150,
    });
    await tick();
    const labels = Array.from(container.querySelectorAll('.metric-label')).map((n) => n.textContent);
    const values = Array.from(container.querySelectorAll('.metric-value')).map((n) => n.textContent);
    expect(labels).toContain('Power');
    expect(labels).toContain('HR');
    expect(values).toContain('--'); // pace is falsy
    expect(values).toContain('1:01:40'); // hours branch
  });

  it('surfaces a service error', async () => {
    const { container } = render(FTMSDevice);
    fake.emit('error', { message: 'no FTMS device' });
    await tick();
    expect(container.querySelector('.error-message')?.textContent).toContain('no FTMS device');
  });

  it('removes its listeners on unmount', () => {
    const { unmount } = render(FTMSDevice);
    expect(fake.listeners.get('data')?.size).toBe(1);
    unmount();
    expect(fake.listeners.get('data')?.size ?? 0).toBe(0);
  });
});
