import { useEffect, useRef } from 'react';
import type { PM5Data } from '../types/index';

/**
 * The slice of a rower BLE service this hook needs. Both `bluetoothService` (PM5)
 * and `ftmsBluetoothService` satisfy it.
 */
export interface RowerEventSource {
  on(event: string, listener: (data: unknown) => void): void;
  off(event: string, listener: (data: unknown) => void): void;
}

export interface RowerEventHandlers {
  onData?: (data: PM5Data) => void;
  onConnected?: (deviceName: string) => void;
  onDisconnected?: () => void;
  onError?: (message: string) => void;
}

/**
 * Subscribe to a rower BLE service for as long as the calling component is mounted.
 *
 * The device panels (BluetoothDevice / FTMSDevice) render only on the routes view, so
 * subscribing from them silently dropped every frame the moment a workout started and
 * the view switched to 'workout' — the session then recorded no distance at all.
 * Call this from App, which outlives every view switch, and let the panels subscribe
 * only for their own local display.
 *
 * Handlers are read through a ref so a changing callback identity never tears the
 * subscription down: a resubscribe between two notifications would drop frames.
 */
export function useRowerServiceEvents(
  service: RowerEventSource,
  handlers: RowerEventHandlers,
): void {
  const handlersRef = useRef(handlers);
  useEffect(() => {
    handlersRef.current = handlers;
  });

  useEffect(() => {
    const handleData = (data: unknown) => handlersRef.current.onData?.(data as PM5Data);
    const handleConnected = (data: unknown) => {
      const { deviceName } = (data ?? {}) as { deviceName?: string };
      handlersRef.current.onConnected?.(deviceName ?? '');
    };
    const handleDisconnected = () => handlersRef.current.onDisconnected?.();
    const handleError = (data: unknown) => {
      const { message } = (data ?? {}) as { message?: string };
      handlersRef.current.onError?.(message ?? 'Unknown error occurred');
    };

    service.on('data', handleData);
    service.on('connected', handleConnected);
    service.on('disconnected', handleDisconnected);
    service.on('error', handleError);

    return () => {
      service.off('data', handleData);
      service.off('connected', handleConnected);
      service.off('disconnected', handleDisconnected);
      service.off('error', handleError);
    };
  }, [service]);
}
