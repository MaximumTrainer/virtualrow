import { render, fireEvent } from '@testing-library/svelte';
import { tick } from 'svelte';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// A tiny emitter standing in for the BLE singleton: the component only uses
// on/off/connect/disconnect, and the test drives it with emit().
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

vi.mock('../lib/services/bluetoothService', () => ({ bluetoothService: fake }));

import BluetoothDevice from '../lib/ui/BluetoothDevice.svelte';

// #542 P1: BluetoothDevice (PM5) ported to Svelte, same DOM/classes the specs use.
describe('BluetoothDevice.svelte', () => {
  beforeEach(() => {
    fake.listeners.clear();
    fake.connect.mockClear();
    fake.disconnect.mockClear();
    fake.connect.mockResolvedValue(true);
    // Run RAF callbacks synchronously so the deferred display updates are testable.
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('renders the disconnected PM5 panel with the connect button', () => {
    const { container } = render(BluetoothDevice);
    expect(container.querySelector('.bluetooth-device-container')).not.toBeNull();
    expect(container.querySelector('.device-name')?.textContent).toBe('Concept2 PM5');
    expect(container.querySelector('.device-status.disconnected')?.textContent?.trim()).toBe(
      '● Disconnected',
    );
    const btn = container.querySelector('.btn-connect');
    expect(btn?.textContent?.trim()).toBe('Connect PM5');
  });

  it('connects via the service and shows the connected readout on the event', async () => {
    const { container } = render(BluetoothDevice);

    await fireEvent.click(container.querySelector('.btn-connect')!);
    expect(fake.connect).toHaveBeenCalledTimes(1);

    fake.emit('connected', { deviceName: 'My PM5' });
    await tick();

    expect(container.querySelector('.device-name')?.textContent).toBe('My PM5');
    expect(container.querySelector('.device-status.connected')?.textContent?.trim()).toBe(
      '● Connected',
    );
    expect(container.querySelector('.btn-disconnect')).not.toBeNull();
    expect(container.querySelector('.btn-connect')).toBeNull();
  });

  it('renders the live metrics grid from a data event', async () => {
    const { container } = render(BluetoothDevice);
    fake.emit('data', {
      pace: 123.45,
      distance: 2500,
      elapsedTime: 65000,
      power: 180,
      cadence: 26,
      heartRate: 140,
    });
    await tick();

    const values = Array.from(container.querySelectorAll('.metric-value')).map((n) =>
      n.textContent,
    );
    expect(values).toContain('123.5'); // pace
    expect(values).toContain('2.50'); // distance km
    expect(values).toContain('1:05'); // time
    expect(values).toContain('180'); // power
  });

  it('disconnects on the disconnect button and clears state on the event', async () => {
    const { container } = render(BluetoothDevice);
    fake.emit('connected', { deviceName: 'My PM5' });
    await tick();

    await fireEvent.click(container.querySelector('.btn-disconnect')!);
    expect(fake.disconnect).toHaveBeenCalledTimes(1);

    fake.emit('disconnected');
    await tick();
    expect(container.querySelector('.device-status.disconnected')).not.toBeNull();
  });

  it('surfaces a service error', async () => {
    const { container } = render(BluetoothDevice);
    fake.emit('error', { message: 'no device found' });
    await tick();
    expect(container.querySelector('.error-message')?.textContent).toContain('no device found');
  });

  it('falls back to the default name when the connected event carries none', async () => {
    const { container } = render(BluetoothDevice);
    fake.emit('connected', {});
    await tick();
    expect(container.querySelector('.device-name')?.textContent).toBe('Concept2 PM5');
  });

  it('re-enables the connect button when connect() resolves false', async () => {
    fake.connect.mockResolvedValue(false);
    const { container } = render(BluetoothDevice);
    await fireEvent.click(container.querySelector('.btn-connect')!);
    await tick();
    const btn = container.querySelector('.btn-connect') as HTMLButtonElement;
    expect(btn).not.toBeNull();
    expect(btn.disabled).toBe(false);
  });

  it('shows a generic message for an error event with no message', async () => {
    const { container } = render(BluetoothDevice);
    fake.emit('error', {});
    await tick();
    expect(container.querySelector('.error-message')?.textContent).toContain(
      'Unknown error occurred',
    );
  });

  it('renders "--" for a zero pace and an hours-long time', async () => {
    const { container } = render(BluetoothDevice);
    fake.emit('data', { pace: 0, distance: 5000, elapsedTime: 3_700_000 });
    await tick();
    const values = Array.from(container.querySelectorAll('.metric-value')).map((n) => n.textContent);
    expect(values).toContain('--'); // pace is falsy
    expect(values).toContain('1:01:40'); // hours branch of formatTime
  });

  it('removes its listeners on unmount', () => {
    const { unmount } = render(BluetoothDevice);
    expect(fake.listeners.get('connected')?.size).toBe(1);
    unmount();
    expect(fake.listeners.get('connected')?.size ?? 0).toBe(0);
  });
});
