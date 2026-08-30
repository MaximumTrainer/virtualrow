import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import {
  useRowerServiceEvents,
  type RowerEventSource,
  type RowerEventHandlers,
} from '../hooks/useRowerServiceEvents';
import type { PM5Data } from '../types/index';

function createMockService(): RowerEventSource & {
  emit: (event: string, data?: unknown) => void;
  listenerCount: (event: string) => number;
} {
  const listeners = new Map<string, Set<(data: unknown) => void>>();

  return {
    on(event: string, listener: (data: unknown) => void) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(listener);
    },
    off(event: string, listener: (data: unknown) => void) {
      listeners.get(event)?.delete(listener);
    },
    emit(event: string, data?: unknown) {
      listeners.get(event)?.forEach((fn) => fn(data));
    },
    listenerCount(event: string) {
      return listeners.get(event)?.size ?? 0;
    },
  };
}

function makePM5Frame(overrides: Partial<PM5Data> = {}): PM5Data {
  return { distance: 100, elapsedTime: 30_000, pace: 120, power: 200, cadence: 28, ...overrides };
}

describe('useRowerServiceEvents', () => {
  // #210 AC-1′ — before this hook existed, BluetoothDevice/FTMSDevice subscribed
  // from the routes view. When the view switched to 'workout', the components
  // unmounted, tearing down the listeners, and the session recorded 0 m for the
  // whole row. This test proves the App-level subscription delivers data regardless
  // of which view is active.
  it('delivers data events to the handler continuously', () => {
    const service = createMockService();
    const onData = vi.fn();

    renderHook(() => useRowerServiceEvents(service, { onData }));

    const frame1 = makePM5Frame({ distance: 100 });
    const frame2 = makePM5Frame({ distance: 200 });
    const frame3 = makePM5Frame({ distance: 300 });

    act(() => service.emit('data', frame1));
    act(() => service.emit('data', frame2));
    act(() => service.emit('data', frame3));

    expect(onData).toHaveBeenCalledTimes(3);
    expect(onData).toHaveBeenNthCalledWith(1, frame1);
    expect(onData).toHaveBeenNthCalledWith(2, frame2);
    expect(onData).toHaveBeenNthCalledWith(3, frame3);
  });

  // #210 AC-3 — the subscription is registered once (keyed on the service
  // reference) and never torn down by a re-render or by an unrelated component
  // unmounting. Only unmounting the host component (App) cleans up.
  it('keeps the subscription alive across handler identity changes', () => {
    const service = createMockService();
    const onData1 = vi.fn();
    const onData2 = vi.fn();

    const { rerender } = renderHook(
      ({ handlers }: { handlers: RowerEventHandlers }) =>
        useRowerServiceEvents(service, handlers),
      { initialProps: { handlers: { onData: onData1 } } },
    );

    expect(service.listenerCount('data')).toBe(1);

    // Simulate a re-render with a new handler identity — must not re-subscribe
    rerender({ handlers: { onData: onData2 } });
    expect(service.listenerCount('data')).toBe(1);

    act(() => service.emit('data', makePM5Frame()));

    expect(onData1).not.toHaveBeenCalled();
    expect(onData2).toHaveBeenCalledTimes(1);
  });

  it('unsubscribes only when the host unmounts, not on re-render', () => {
    const service = createMockService();
    const onData = vi.fn();

    const { unmount, rerender } = renderHook(
      ({ handlers }: { handlers: RowerEventHandlers }) =>
        useRowerServiceEvents(service, handlers),
      { initialProps: { handlers: { onData } } },
    );

    rerender({ handlers: { onData } });
    expect(service.listenerCount('data')).toBe(1);

    unmount();
    expect(service.listenerCount('data')).toBe(0);

    act(() => service.emit('data', makePM5Frame()));
    expect(onData).not.toHaveBeenCalled();
  });

  it('forwards connected events with the device name', () => {
    const service = createMockService();
    const onConnected = vi.fn();

    renderHook(() => useRowerServiceEvents(service, { onConnected }));

    act(() => service.emit('connected', { deviceName: 'Concept2 PM5' }));

    expect(onConnected).toHaveBeenCalledWith('Concept2 PM5');
  });

  it('forwards disconnected events', () => {
    const service = createMockService();
    const onDisconnected = vi.fn();

    renderHook(() => useRowerServiceEvents(service, { onDisconnected }));

    act(() => service.emit('disconnected'));

    expect(onDisconnected).toHaveBeenCalledTimes(1);
  });

  it('forwards error events with the message', () => {
    const service = createMockService();
    const onError = vi.fn();

    renderHook(() => useRowerServiceEvents(service, { onError }));

    act(() => service.emit('error', { message: 'GATT connection lost' }));

    expect(onError).toHaveBeenCalledWith('GATT connection lost');
  });

  it('defaults device name to empty string when payload is missing', () => {
    const service = createMockService();
    const onConnected = vi.fn();

    renderHook(() => useRowerServiceEvents(service, { onConnected }));

    act(() => service.emit('connected', undefined));

    expect(onConnected).toHaveBeenCalledWith('');
  });

  it('defaults error message when payload is missing', () => {
    const service = createMockService();
    const onError = vi.fn();

    renderHook(() => useRowerServiceEvents(service, { onError }));

    act(() => service.emit('error', undefined));

    expect(onError).toHaveBeenCalledWith('Unknown error occurred');
  });

  // #210 AC-4′ — FTMS and HR use the same subscription mechanism. This test
  // proves a second independent service instance has its own subscription
  // lifecycle, confirming the pattern generalises to all rower types.
  it('supports two independent services with separate subscriptions', () => {
    const pm5Service = createMockService();
    const ftmsService = createMockService();
    const onPM5Data = vi.fn();
    const onFTMSData = vi.fn();

    renderHook(() => {
      useRowerServiceEvents(pm5Service, { onData: onPM5Data });
      useRowerServiceEvents(ftmsService, { onData: onFTMSData });
    });

    act(() => pm5Service.emit('data', makePM5Frame({ distance: 100 })));
    act(() => ftmsService.emit('data', makePM5Frame({ distance: 200 })));

    expect(onPM5Data).toHaveBeenCalledTimes(1);
    expect(onPM5Data).toHaveBeenCalledWith(expect.objectContaining({ distance: 100 }));
    expect(onFTMSData).toHaveBeenCalledTimes(1);
    expect(onFTMSData).toHaveBeenCalledWith(expect.objectContaining({ distance: 200 }));
  });
});
