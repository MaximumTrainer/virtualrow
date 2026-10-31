import { describe, it, expect, vi, beforeEach } from 'vitest';
import { flushSync } from 'svelte';

import { SessionStore, type SessionStoreDeps } from '../lib/ui/sessionStore.svelte';
import type { WaterRoute } from '../lib/types/index';

/** A tiny event emitter standing in for a BLE service's on/off. */
function emitter() {
  const listeners = new Map<string, Set<(data: unknown) => void>>();
  return {
    on: vi.fn((event: string, fn: (data: unknown) => void) => {
      (listeners.get(event) ?? listeners.set(event, new Set()).get(event)!).add(fn);
    }),
    off: vi.fn((event: string, fn: (data: unknown) => void) => {
      listeners.get(event)?.delete(fn);
    }),
    emit(event: string, data?: unknown) {
      listeners.get(event)?.forEach((fn) => fn(data));
    },
  };
}

function route(over: Partial<WaterRoute> = {}): WaterRoute {
  return {
    id: 'r1',
    name: 'Route r1',
    location: 'Somewhere',
    distance: 5,
    estimatedTime: 20,
    difficulty: 'moderate',
    coordinates: [],
    ...over,
  } as unknown as WaterRoute;
}

function makeDeps() {
  const bluetoothService = emitter();
  const ftmsBluetoothService = emitter();
  const heartRateBluetoothService = emitter();
  const startSession = vi.fn(() => ({ id: 's1' }) as never);
  const getCurrentSession = vi.fn(() => null);
  const deps = {
    bluetoothService,
    ftmsBluetoothService,
    heartRateBluetoothService,
    workoutService: { startSession, getCurrentSession },
    audioService: {
      getVolume: vi.fn(() => 0.4),
      setVolume: vi.fn(),
      enable: vi.fn(async () => {}),
      disable: vi.fn(async () => {}),
    },
    pm5Simulator: { updateSettings: vi.fn(), start: vi.fn(), isRunning: vi.fn(() => false) },
    heartRateSimulator: { start: vi.fn(), isRunning: vi.fn(() => false) },
  };
  return deps as unknown as SessionStoreDeps & typeof deps;
}

// #542 P1 Row screen: the device / demo / session store ported from App.tsx.
describe('SessionStore', () => {
  let store: SessionStore;
  let deps: ReturnType<typeof makeDeps>;

  beforeEach(() => {
    deps = makeDeps();
    store = new SessionStore(deps);
  });

  it('seeds the volume from the audio service', () => {
    expect(store.soundVolume).toBe(0.4);
  });

  it('tracks connection through the BLE events after init, and tears down', () => {
    const stop = $effect.root(() => {
      const teardown = store.init();

      deps.bluetoothService.emit('connected');
      deps.heartRateBluetoothService.emit('connected');
      flushSync();
      expect(store.pm5Connected).toBe(true);
      expect(store.hrConnected).toBe(true);
      // PM5 is the active rower, so the selected rower now reads connected.
      expect(store.selectedRowerConnected).toBe(true);

      deps.bluetoothService.emit('disconnected');
      flushSync();
      expect(store.pm5Connected).toBe(false);

      teardown();
      deps.bluetoothService.emit('connected');
      flushSync();
      // After teardown the listener is gone, so the event is not tracked.
      expect(store.pm5Connected).toBe(false);
    });
    stop();
  });

  it('switches the active rower and its label / connected derivation', () => {
    const stop = $effect.root(() => {
      store.init();
      store.ftmsConnected = true;
      store.setActiveRowerType('ftms');
      flushSync();
      expect(store.activeRowerLabel).toBe('FTMS');
      expect(store.selectedRowerConnected).toBe(true);
    });
    stop();
  });

  it('drives the audio service from the sound controls', () => {
    store.setSoundEnabled(true);
    expect(deps.audioService.enable).toHaveBeenCalled();
    store.setSoundEnabled(false);
    expect(deps.audioService.disable).toHaveBeenCalled();
    store.setSoundVolume(0.7);
    expect(store.soundVolume).toBe(0.7);
    expect(deps.audioService.setVolume).toHaveBeenCalledWith(0.7);
  });

  it('does not start a workout until both devices are connected', () => {
    const stop = $effect.root(() => {
      store.init();
      store.startWorkout(route(), false);
      expect(deps.workoutService.startSession).not.toHaveBeenCalled();

      store.pm5Connected = true;
      store.hrConnected = true;
      flushSync();
      store.startWorkout(route(), false);
      expect(deps.workoutService.startSession).toHaveBeenCalledWith(
        'r1',
        'Route r1',
        undefined,
        'pm5',
        true,
        false,
        [],
      );
      expect(store.sessionState).toBe('active');
    });
    stop();
  });

  it('starts a demo only when allowed, bringing the simulators up', () => {
    store.startDemo(route(), true, false);
    expect(deps.workoutService.startSession).not.toHaveBeenCalled();

    store.startDemo(route(), true, true);
    expect(deps.pm5Simulator.start).toHaveBeenCalled();
    expect(deps.heartRateSimulator.start).toHaveBeenCalledWith(130);
    expect(store.isDemoMode).toBe(true);
    expect(store.pm5Connected).toBe(true);
    expect(deps.workoutService.startSession).toHaveBeenCalledWith(
      'r1',
      'Route r1',
      undefined,
      'pm5',
      true,
      true,
      [],
    );
  });

  it('will not start when a session is already in progress', () => {
    store.onSessionStarted();
    expect(store.sessionActive).toBe(true);
    store.pm5Connected = true;
    store.hrConnected = true;
    store.startWorkout(route(), false);
    expect(deps.workoutService.startSession).not.toHaveBeenCalled();

    store.onSessionEnded();
    expect(store.sessionActive).toBe(false);
    expect(store.sessionState).toBe('idle');
  });

  it('reports hr connectivity from the monitor callback too', () => {
    store.setHrConnected(true);
    expect(store.hrConnected).toBe(true);
  });

  it('constructs against the production singletons by default', () => {
    expect(() => new SessionStore()).not.toThrow();
  });

  it('does not start without a route even when devices are connected', () => {
    store.pm5Connected = true;
    store.hrConnected = true;
    store.startWorkout(null, false);
    expect(deps.workoutService.startSession).not.toHaveBeenCalled();
    store.startDemo(null, false, true);
    expect(deps.workoutService.startSession).not.toHaveBeenCalled();
  });

  it('leaves an already-running heart-rate simulator alone on demo', () => {
    const d = makeDeps();
    d.heartRateSimulator.isRunning = vi.fn(() => true);
    const s = new SessionStore(d);
    s.startDemo(route(), true, true);
    expect(d.heartRateSimulator.start).not.toHaveBeenCalled();
    expect(d.workoutService.startSession).toHaveBeenCalled();
  });
});
