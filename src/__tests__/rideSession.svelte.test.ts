import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { flushSync } from 'svelte';

// The post-finish routing keys the local save/history off the store; stub the
// store module so the routing can be asserted without touching localStorage.
const localStore = vi.hoisted(() => ({
  saveCompletedSession: vi.fn(),
  markSessionUploaded: vi.fn(),
  loadSessions: vi.fn(() => [] as unknown[]),
}));
vi.mock('../lib/services/localStorageWorkoutStore', () => localStore);

import { RideSessionStore, FINISH_BANNER_MS } from '../lib/ui/rideSession.svelte';
import type {
  RideSessionSession,
  RideSessionRoutes,
  RideSessionDeps,
  RideSessionAuth,
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

function setup(
  over: {
    route?: WaterRoute | null;
    session?: Partial<WorkoutSession>;
    auth?: RideSessionAuth;
  } = {},
) {
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
  const auth: RideSessionAuth = over.auth ?? { user: null, isAuthenticated: false };
  const ride = new RideSessionStore(session, routes, deps, auth);
  return {
    ride,
    session,
    routes,
    pm5,
    ftms,
    hr,
    auth,
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

  it('feeds a simulated PM5 frame from the debug panel into the session', () => {
    const { ride, session, deps } = setup();
    const teardown = ride.init();
    session.sessionActive = true;

    const stop = $effect.root(() => {
      ride.onSimulatedData(packet({ distance: 42, pace: 118 }));
      flushSync();
      expect(deps.workoutService.updateSessionWithPM5Data).toHaveBeenCalledWith(
        expect.objectContaining({ distance: 42 }),
      );
      expect(ride.pm5Data?.distance).toBe(42);
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

  describe('the post-finish summary (#221, #337, #338)', () => {
    const athlete: RideSessionAuth = { user: { id: 'u1' }, isAuthenticated: true };

    beforeEach(() => {
      localStore.saveCompletedSession.mockClear();
      localStore.markSessionUploaded.mockClear();
      localStore.loadSessions.mockClear();
      localStore.loadSessions.mockReturnValue([]);
    });

    it('keeps a signed-in row for the summary and stores it locally (AC6.1)', () => {
      const completed = { id: 's1', isGuest: false, distance: 2000 } as unknown as WorkoutSession;
      const { ride } = setup({ auth: athlete, session: completed });
      ride.endWorkout();

      expect(ride.completedSession?.id).toBe('s1');
      expect(ride.guestCompletedSession).toBeNull();
      expect(localStore.saveCompletedSession).toHaveBeenCalledWith('u1', expect.objectContaining({ id: 's1' }), { isDemo: false });
    });

    it('sends a guest row to the guest summary and never stores it (AC5.1)', () => {
      const completed = { id: 'g1', isGuest: true, distance: 1500 } as unknown as WorkoutSession;
      const { ride } = setup({ auth: athlete, session: completed });
      ride.endWorkout();

      expect(ride.guestCompletedSession?.id).toBe('g1');
      expect(ride.completedSession).toBeNull();
      expect(localStore.saveCompletedSession).not.toHaveBeenCalled();
    });

    it('flags a signed-in demo so it keeps the summary but never the log (AC5.3)', () => {
      const completed = { id: 'd1', isGuest: false, distance: 800 } as unknown as WorkoutSession;
      const { ride, session, deps } = setup({ auth: athlete, session: completed });
      session.isDemoMode = true;
      ride.endWorkout();

      expect(ride.completedSession?.id).toBe('d1');
      expect(ride.completedSessionWasDemo).toBe(true);
      expect(deps.pm5Simulator.stop).toHaveBeenCalled();
      // saveCompletedSession is told it is a demo (the store itself then no-ops).
      expect(localStore.saveCompletedSession).toHaveBeenCalledWith('u1', expect.anything(), { isDemo: true });
    });

    it('shows no summary when the row produced nothing', () => {
      const { ride, setCurrent } = setup({ auth: athlete });
      setCurrent(null);
      ride.endWorkout();

      expect(ride.completedSession).toBeNull();
      expect(ride.guestCompletedSession).toBeNull();
    });

    it('records the upload against the stored row, then dismisses (AC6.2)', () => {
      const completed = { id: 's1', isGuest: false, distance: 2000 } as unknown as WorkoutSession;
      const { ride } = setup({ auth: athlete, session: completed });
      ride.endWorkout();

      ride.sessionSaved('a9');
      expect(localStore.markSessionUploaded).toHaveBeenCalledWith('u1', 's1', 'a9');

      ride.sessionDone();
      expect(ride.completedSession).toBeNull();
    });

    it('dismisses the guest summary on Row Again / Done', () => {
      const completed = { id: 'g1', isGuest: true, distance: 1500 } as unknown as WorkoutSession;
      const { ride } = setup({ auth: athlete, session: completed });
      ride.endWorkout();
      expect(ride.guestCompletedSession).not.toBeNull();

      ride.guestDone();
      expect(ride.guestCompletedSession).toBeNull();
    });

    it('settles the race against the ghost once the row has finished (#338)', () => {
      const completed = { id: 's1', isGuest: false, distance: 1000 } as unknown as WorkoutSession;
      const { ride, session } = setup({ auth: athlete, session: completed });
      session.ghostChoice = { kind: 'pace', paceSPer500: 120 };
      ride.endWorkout();

      const stop = $effect.root(() => {
        flushSync();
        expect(ride.completedGhost).not.toBeNull();
        expect(typeof ride.completedGhost?.seconds).toBe('number');
        expect(ride.completedGhost?.label).toContain('pace');
      });
      stop();
    });

    it('offers no personal-best comparison without an athlete or for a demo (#337)', () => {
      const completed = { id: 's1', isGuest: false, distance: 1000 } as unknown as WorkoutSession;

      // No athlete: nothing to compare against.
      const guest = setup({ session: { ...completed, isGuest: true } });
      guest.ride.endWorkout();
      const stopGuest = $effect.root(() => {
        flushSync();
        expect(guest.ride.completedSessionBest).toBeUndefined();
      });
      stopGuest();

      // Signed-in demo: not theirs to compare.
      const demo = setup({ auth: athlete, session: completed });
      demo.session.isDemoMode = true;
      demo.ride.endWorkout();
      const stopDemo = $effect.root(() => {
        flushSync();
        expect(demo.ride.completedSessionBest).toBeUndefined();
      });
      stopDemo();
    });
  });
});
