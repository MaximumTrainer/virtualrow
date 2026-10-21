import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { flushSync } from 'svelte';

import { RideSessionStore, FINISH_BANNER_MS } from '../lib/ui/rideSession.svelte';
import type {
  RideSessionSession,
  RideSessionRoutes,
  RideSessionDeps,
} from '../lib/ui/rideSession.svelte';
import type { PM5Data, WaterRoute, WorkoutSession } from '../lib/types/index';
import type { GhostChoice } from '../lib/ui/ghostChoice';
import type { RowerType, SessionState } from '../lib/ui/sessionStore.svelte';

/** A reactive stand-in for the slice of SessionStore the ride store reads. */
class SessionStub implements RideSessionSession {
  activeRowerType = $state<RowerType>('pm5');
  isDemoMode = $state(false);
  sessionActive = $state(false);
  sessionState = $state<SessionState>('idle');
  pm5Connected = $state(true);
  ftmsConnected = $state(false);
  hrConnected = $state(true);
  ghostChoice = $state<GhostChoice>({ kind: 'none' });
  currentWorkout = { stop: vi.fn(), tick: vi.fn(), speedFactor: undefined as number | undefined };
  get selectedRowerConnected(): boolean {
    return this.activeRowerType === 'pm5' ? this.pm5Connected : this.ftmsConnected;
  }
}

class RoutesStub implements RideSessionRoutes {
  selectedRoute = $state<WaterRoute | null>(null);
}

function route(distanceKm: number): WaterRoute {
  return {
    id: 'r1',
    name: 'Lake',
    location: 'Somewhere',
    distance: distanceKm,
    estimatedTime: 20,
    difficulty: 'moderate',
    coordinates: [],
  } as unknown as WaterRoute;
}

/** A listener registry standing in for a BLE service's on/off. */
function evented() {
  const map = new Map<string, Set<(d: unknown) => void>>();
  return {
    on: vi.fn((e: string, l: (d: unknown) => void) => {
      (map.get(e) ?? map.set(e, new Set()).get(e)!).add(l);
    }),
    off: vi.fn((e: string, l: (d: unknown) => void) => map.get(e)?.delete(l)),
    emit(e: string, d: unknown) {
      map.get(e)?.forEach((l) => l(d));
    },
  };
}

function setup(over: { route?: WaterRoute | null; session?: Partial<WorkoutSession> } = {}) {
  const session = new SessionStub();
  const routes = new RoutesStub();
  routes.selectedRoute = over.route ?? route(1);

  const pm5 = evented();
  const ftms = evented();
  const hr = evented();
  let current: WorkoutSession | null = {
    distance: 0,
    duration: 0,
    heartRateSamples: [],
  } as unknown as WorkoutSession;
  if (over.session) current = { ...current, ...over.session } as WorkoutSession;

  const deps: Partial<RideSessionDeps> = {
    workoutService: {
      updateSessionWithPM5Data: vi.fn(),
      updateSessionHeartRate: vi.fn(),
      getCurrentSession: vi.fn(() => current),
      pauseSession: vi.fn(),
      resumeSession: vi.fn(),
      endSession: vi.fn(() => current),
    },
    bluetoothService: pm5,
    ftmsBluetoothService: ftms,
    heartRateBluetoothService: hr,
    pm5Simulator: { addListener: vi.fn(), removeListener: vi.fn(), stop: vi.fn() },
    heartRateSimulator: { stop: vi.fn() },
    raf: (cb) => cb(), // run the deferred update synchronously
    now: () => 0,
  };
  const ride = new RideSessionStore(session, routes, deps);
  return {
    ride,
    session,
    routes,
    pm5,
    ftms,
    hr,
    deps: deps as Required<RideSessionDeps>,
    setCurrent: (s: WorkoutSession | null) => (current = s),
  };
}

const packet = (over: Partial<PM5Data> = {}): PM5Data =>
  ({ distance: 0, elapsedTime: 0, ...over }) as PM5Data;

describe('RideSessionStore', () => {
  it('routes only the selected rower\'s packets into the session', () => {
    const { ride, session, pm5, ftms, deps } = setup();
    const teardown = ride.init();
    session.sessionActive = true;

    const stop = $effect.root(() => {
      // FTMS is not the selected rower → its packet is ignored.
      ftms.emit('data', packet({ distance: 10 }));
      flushSync();
      expect(deps.workoutService.updateSessionWithPM5Data).not.toHaveBeenCalled();

      pm5.emit('data', packet({ distance: 25, pace: 120, power: 150, cadence: 24 }));
      flushSync();
      expect(deps.workoutService.updateSessionWithPM5Data).toHaveBeenCalledOnce();
      expect(ride.pm5Data?.distance).toBe(25);
      expect(session.currentWorkout.tick).toHaveBeenCalled();
    });
    stop();
    teardown();
  });

  it('ignores a packet after the subscription is torn down', () => {
    const { ride, session, pm5, deps } = setup();
    const teardown = ride.init();
    session.sessionActive = true;
    teardown();
    pm5.emit('data', packet({ distance: 5 }));
    expect(deps.workoutService.updateSessionWithPM5Data).not.toHaveBeenCalled();
  });

  it('records heart-rate samples from the HR service', () => {
    const { ride, hr, deps, setCurrent } = setup();
    const teardown = ride.init();
    setCurrent({
      distance: 0,
      duration: 0,
      heartRateSamples: [{ bpm: 142, timestamp: new Date() }],
    } as unknown as WorkoutSession);

    const stop = $effect.root(() => {
      hr.emit('heartRate', { bpm: 142 });
      flushSync();
      expect(deps.workoutService.updateSessionHeartRate).toHaveBeenCalledWith(142);
      expect(ride.heartRateSamples).toHaveLength(1);
      expect(ride.latestHeartRate).toBe(142);
    });
    stop();
    teardown();
  });

  it('derives elapsed time, stroke intensity and progress from the packet', () => {
    const { ride, session, pm5 } = setup({ route: route(2) });
    const teardown = ride.init();
    session.sessionActive = true;
    const stop = $effect.root(() => {
      pm5.emit('data', packet({ distance: 1000, elapsedTime: 90, power: 300 }));
      flushSync();
      expect(ride.workoutElapsedTimeMs).toBe(90_000);
      expect(ride.elapsedSeconds).toBe(90);
      expect(ride.strokeIntensity).toBe(1); // 300/300 clamped to 1
      // 1000 m of a 2 km route = 50 %.
      expect(ride.activityProgressPercent).toBeCloseTo(50);
    });
    stop();
    teardown();
  });

  it('reads the gap to a pace ghost once the row has started', () => {
    const { ride, session, pm5 } = setup({ route: route(5) });
    const teardown = ride.init();
    session.sessionActive = true;
    session.ghostChoice = { kind: 'pace', paceSPer500: 120 }; // 500 m / 120 s
    const stop = $effect.root(() => {
      // Before the first stroke there is no gap worth reading.
      expect(ride.ghostGap?.gapMeters ?? null).toBeNull();
      pm5.emit('data', packet({ distance: 100, elapsedTime: 60 }));
      flushSync();
      // Ghost at 60 s and ~4.17 m/s is ~250 m; the rower at 100 m is behind.
      expect(ride.ghostGap).not.toBeNull();
      expect(typeof ride.ghostGap?.gapMeters).toBe('number');
      expect(ride.ghostGap?.label).toContain('pace');
    });
    stop();
    teardown();
  });

  describe('with fake timers', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('stamps the first stroke so the start sequence can count from it', () => {
      const { ride, session, pm5 } = setup();
      const teardown = ride.init();
      session.sessionActive = true;
      const stop = $effect.root(() => {
        pm5.emit('data', packet({ distance: 1, cadence: 22 }));
        flushSync();
        vi.advanceTimersByTime(0);
        flushSync();
        expect(ride.strokeAt).not.toBeNull();
      });
      stop();
      teardown();
    });

    it('finishes at the route length and ends the row after the banner', () => {
      const { ride, session, pm5, deps } = setup({ route: route(1) }); // 1000 m
      const teardown = ride.init();
      session.sessionActive = true;
      const stop = $effect.root(() => {
        pm5.emit('data', packet({ distance: 999, elapsedTime: 200 }));
        flushSync();
        expect(ride.finish).not.toBeNull();
        expect(ride.finish?.distanceMeters).toBe(1000);
        expect(deps.workoutService.endSession).not.toHaveBeenCalled();
        vi.advanceTimersByTime(FINISH_BANNER_MS);
        expect(deps.workoutService.endSession).toHaveBeenCalledOnce();
        expect(session.currentWorkout.stop).toHaveBeenCalled();
      });
      stop();
      teardown();
    });
  });

  it('pause, resume and reset drive the service and the session state', () => {
    const { ride, session, deps } = setup();
    ride.pauseWorkout();
    expect(session.sessionState).toBe('paused');
    expect(deps.workoutService.pauseSession).toHaveBeenCalled();
    ride.resumeWorkout();
    expect(session.sessionState).toBe('active');
    expect(deps.workoutService.resumeSession).toHaveBeenCalled();
    ride.activityElapsedMs = 5000;
    ride.resetWorkout();
    expect(ride.activityElapsedMs).toBe(0);
  });

  it('ending a demo row stops the simulators', () => {
    const { ride, session, deps } = setup();
    session.isDemoMode = true;
    ride.endWorkout();
    expect(deps.workoutService.endSession).toHaveBeenCalled();
    expect(session.currentWorkout.stop).toHaveBeenCalled();
    expect(deps.pm5Simulator.stop).toHaveBeenCalled();
    expect(deps.heartRateSimulator.stop).toHaveBeenCalled();
  });

  it('setActive(false) clears the row\'s transient state', () => {
    const { ride, session, pm5 } = setup();
    const teardown = ride.init();
    session.sessionActive = true;
    const stop = $effect.root(() => {
      pm5.emit('data', packet({ distance: 40 }));
      flushSync();
      expect(ride.pm5Data).not.toBeNull();
      ride.setActive(false);
      flushSync();
      expect(ride.pm5Data).toBeNull();
      expect(ride.currentSession).toBeNull();
      expect(ride.activityElapsedMs).toBe(0);
    });
    stop();
    teardown();
  });

  it('subscribes and unsubscribes the demo simulator listener idempotently', () => {
    const { ride, deps } = setup();
    ride.setDemoListening(true);
    ride.setDemoListening(true);
    expect(deps.pm5Simulator.addListener).toHaveBeenCalledOnce();
    ride.setDemoListening(false);
    expect(deps.pm5Simulator.removeListener).toHaveBeenCalledOnce();
  });

  it('frame() snapshots the live row state for the engine seam', () => {
    const { ride, session, pm5 } = setup({ route: route(2) });
    const teardown = ride.init();
    session.sessionActive = true;
    session.sessionState = 'active';
    const stop = $effect.root(() => {
      pm5.emit('data', packet({ distance: 300, pace: 118, cadence: 26, elapsedTime: 70 }));
      flushSync();
      const f = ride.frame();
      expect(f.paceSPer500).toBe(118);
      expect(f.distanceMeters).toBe(300);
      expect(f.cadence).toBe(26);
      expect(f.isPlaying).toBe(true);
      expect(f.finished).toBe(false);
      expect(f.intensityFactor).toBe(1);
      expect(f.elapsedSeconds).toBe(70);
    });
    stop();
    teardown();
  });

  it('onStarted seeds the recording session before the first packet', () => {
    const { ride } = setup();
    const seeded = { distance: 7, duration: 0 } as unknown as WorkoutSession;
    ride.onStarted(seeded);
    expect(ride.currentSession?.distance).toBe(7);
    ride.onStarted(null);
    expect(ride.currentSession).toBeNull();
  });
});
