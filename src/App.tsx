import { useState, useEffect, useCallback, useMemo, useRef, lazy, Suspense } from 'react';
import { RouteMap } from './components/RouteMap';
import { BluetoothDevice } from './components/BluetoothDevice';
import { PM5Simulator } from './components/PM5Simulator';
import { HeartRateSimulator } from './components/HeartRateSimulator';
import { RownativeRouteImport } from './components/RownativeRouteImport';
import { FTMSDevice } from './components/FTMSDevice';
import { routeService } from './services/routeService';
import { workoutService } from './services/workoutService';
import HeartRateMonitor from './components/HeartRateMonitor';
import { heartRateBluetoothService } from './services/heartRateBluetoothService';
import { bluetoothService } from './services/bluetoothService';
import { ftmsBluetoothService } from './services/ftmsBluetoothService';
// Rower3D pulls in three, @react-three/{fiber,drei,postprocessing,rapier} (~hundreds of kB).
// Code-split it so the routes view doesn't pay the cost — the chunk only
// loads when the user actually starts a workout (currentView === 'workout').
const Rower3D = lazy(() => import('./components/Rower3D'));
import { RouteThumbnail } from './components/RouteThumbnail';
import { GuestSessionSummary } from './components/GuestSessionSummary';
import { SessionSummary } from './components/SessionSummary';
import { AuthButton } from './components/AuthButton';
import { heartRateSimulator } from './services/heartRateSimulatorService';
import { pm5Simulator } from './services/pm5SimulatorService';
import { useAuth } from './context/useAuth';
import { resolveCrew, CREW_URL } from './components/rower3d/crewModel';
import { RouteLoadingBar } from './components/RouteLoadingBar';
import { useRouteLoadProgress } from './hooks/useRouteLoadProgress';
import { isGlbSceneryEnabled } from './components/rower3d/sceneryAssets';
import { readTelemetry, telemetryAsText, clearTelemetry } from './utils/sceneTelemetryLog';
import { useServices } from './context/useServices';
import { useRownativeDeepLink } from './hooks/useRownativeDeepLink';
import { useRowerServiceEvents } from './hooks/useRowerServiceEvents';
import { OUTLINE_ONLY_TAG } from './services/routeService';
import { externalDistanceNote, formatRouteDistanceKm, geometryProvenanceBadge } from './utils/geometryProvenance';
import { TrackParseError, detectTrackFormat } from './utils/trackParsers';
import { resolvePerformanceMode } from './components/rower3d/constants';
import { useGraphicsQuality } from './hooks/useGraphicsQuality';
import { GraphicsQualityPicker } from './components/GraphicsQualityPicker';
import { SoundPicker } from './components/SoundPicker';
import { useRaceCues } from './hooks/useRaceCues';
import { ConditionsPicker } from './components/ConditionsPicker';
import { useConditions } from './hooks/useConditions';
import { CrewPicker } from './components/CrewPicker';
import { useCrewPreference } from './hooks/useCrewPreference';
import { useRenderStats } from './hooks/useRenderStats';
import { RENDER_BUDGET, overBudget } from './components/rower3d/renderBudget';
import type { PerformanceMode } from './components/rower3d/constants';
import { useStructuredWorkout } from './hooks/useStructuredWorkout';
import { WorkoutLibrary } from './components/WorkoutLibrary';
import { WorkoutOverlay } from './components/WorkoutOverlay';
import { RowHud } from './components/RowHud';
import { useFullscreen } from './hooks/useFullscreen';
import { isStrokeReading, useStartSequence } from './hooks/useStartSequence';
import { FinishBanner, StartCallout } from './components/RaceCallouts';
import { loadSessions, markSessionUploaded, saveCompletedSession } from './services/localStorageWorkoutStore';
import { bestPaceOnRoute } from './utils/sessionSummary';
import { formatSplit } from './utils/formatters';
import { GhostPicker, type GhostChoice } from './components/GhostPicker';
import {
  bestRowOnRoute,
  gapMeters,
  ghostDistanceAt,
  ghostFinishSeconds,
  paceGhost,
  recordedGhost,
} from './components/rower3d/ghost';
import type { WaterRoute, PM5Data, WorkoutSession, HeartRateSample } from './types/index';
import type { RouteEnrichmentData } from './services/routeEnrichmentService';
import './App.css';

// Session state type for workout controls
type SessionState = 'idle' | 'active' | 'paused';

/**
 * The three screens (issue #219, R3).
 *
 * `routes` is the Row screen — one route, the devices and the two ways to
 * start. `route-search` is where a different route is found and chosen.
 * `workout` is the running session. State, not a router: the app has no
 * addressable URLs beyond the rownative deep link, so adding one would buy
 * nothing.
 */
type ViewMode = 'routes' | 'route-search' | 'workouts' | 'workout';

/** The bundled demo route, and the fallback when no default resolves. */
const DEMO_ROUTE_ID = '1';

/** How long the finish banner is up before the summary opens (#336). */
const FINISH_BANNER_MS = 2000;

/** Header nav. The workout screen is reached by starting a row, not by a tab. */
const NAV_ITEMS: ReadonlyArray<{ view: ViewMode; label: string }> = [
  { view: 'routes', label: 'Row' },
  { view: 'route-search', label: 'Routes' },
  { view: 'workouts', label: 'Workouts' },
];

/** Extract the rownative.icu status value from route tags (e.g. "status:provisional" → "provisional"). */
function extractRouteStatus(tags: string[] | undefined): string | undefined {
  return tags?.find((t) => t.startsWith('status:'))?.replace('status:', '');
}

/**
 * Provenance of a route's geometry, for the badge.
 *
 * Routes imported before this field existed carry the `outline-only` tag and
 * nothing else, so fall back to reading that.
 */
function routeGeometrySource(route: WaterRoute): WaterRoute['geometrySource'] {
  if (route.geometrySource) return route.geometrySource;
  return route.tags?.includes(OUTLINE_ONLY_TAG) ? 'gate-chain' : undefined;
}

function App() {
  const { isAuthenticated, isLoading, login, user } = useAuth();
  const { routeEnrichmentService, defaultRoutePreferenceStore, audioService } = useServices();
  // In Playwright e2e tests, window.__PLAYWRIGHT_TESTING is set to true by mock-bluetooth.js.
  // Guard all unauthenticated-guest behaviours on this flag so tests can exercise the full UI.
  const isGuestSession = !isAuthenticated && !window.__PLAYWRIGHT_TESTING;
  const showAuthFeatures = isAuthenticated || !!window.__PLAYWRIGHT_TESTING;
  const [currentView, setCurrentView] = useState<ViewMode>('routes');
  // The header nav collapses behind a hamburger below 768px (issue #219, R8).
  const [isNavOpen, setIsNavOpen] = useState(false);
  const [routes, setRoutes] = useState<WaterRoute[]>([]);
  const [selectedRoute, setSelectedRoute] = useState<WaterRoute | null>(null);
  const [isWorkoutActive, setIsWorkoutActive] = useState(false);
  const [currentSession, setCurrentSession] = useState<WorkoutSession | null>(null);
  const [pm5Connected, setPM5Connected] = useState(false);
  const [pm5Data, setPM5Data] = useState<PM5Data | null>(null);
  const [ftmsConnected, setFtmsConnected] = useState(false);
  const [hrConnected, setHrConnected] = useState(false);
  const [heartRateSamples, setHeartRateSamples] = useState<HeartRateSample[]>([]);
  const [activeRowerType, setActiveRowerType] = useState<'pm5' | 'ftms'>('pm5');
  // Filter state for routes
  const [difficultyFilter, setDifficultyFilter] = useState<'all' | 'easy' | 'moderate' | 'hard'>('all');
  const distanceMin = 0;
  const distanceMax = 100;
  // Local activity timer (ms elapsed since workout started)
  const [activityElapsedMs, setActivityElapsedMs] = useState(0);
  // The start and the finish of a row (#336). `strokeAt` is when this session
  // saw its first stroke, not the last reading the erg left from the one before.
  const [strokeAt, setStrokeAt] = useState<number | null>(null);
  const [finish, setFinish] = useState<{ distanceMeters: number; elapsedMs: number } | null>(null);
  const finishingRef = useRef(false);
  const strokeSeenRef = useRef(false);
  const activityTimerRef = useRef<number | null>(null);
  /**
   * The stage, and whether it is filling the screen (#335).
   *
   * Declared here rather than in `RowHud` because the element that goes
   * fullscreen is the stage, and on iOS Safari - which has no Fullscreen API -
   * the fallback is a class on the view around it. Both are outside the HUD.
   */
  const rowStageRef = useRef<HTMLDivElement | null>(null);
  const rowFullscreen = useFullscreen(rowStageRef);
  // Re-entrancy guards — prevent recursive session start or HR update loops
  const isStartingSessionRef = useRef(false);
  const isProcessingHrUpdateRef = useRef(false);
  // RAF-based throttle for PM5/HR state updates — avoids stack overflow when
  // Playwright CDP adds extra frames to the WS→characteristic notification path.
  const pm5DataPendingRef = useRef<PM5Data | null>(null);
  const pm5RafScheduledRef = useRef(false);
  // Debug mode state
  const [debugMode, setDebugMode] = useState(false);
  // The river guides draw the channel centreline and its water edges (#268).
  // Given their own switch so they can be turned off without losing the rest of
  // the debug window (#270).
  const [showRiverGuides, setShowRiverGuides] = useState(true);
  // Replaces the ?glb= query parameter (#270): switching the scenery kit should
  // be a control, not a URL edit. Seeded from the same default the scene uses,
  // so opening the panel changes nothing by itself.
  const [sceneryEnabled, setSceneryEnabled] = useState(() => isGlbSceneryEnabled());
  // Only polled while the panel is open (#232).
  const renderStats = useRenderStats(debugMode);
  // The telemetry log is read the same way: only while someone is looking.
  const [telemetryTick, setTelemetryTick] = useState(0);
  const telemetryEvents = useMemo(
    () => (debugMode ? readTelemetry() : []),
    // renderStats ticks about once a second while the panel is open, which is
    // a good enough clock to keep this fresh without a second timer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [debugMode, telemetryTick, renderStats],
  );
  const telemetryCount = telemetryEvents.length;
  const recentTelemetry = useMemo(
    () =>
      telemetryEvents
        .slice(-12)
        .map((e) => {
          const seconds = (e.at / 1000).toFixed(1).padStart(7, ' ');
          return `${seconds}s  ${e.kind}${e.detail ? ` ${JSON.stringify(e.detail)}` : ''}`;
        })
        .join(String.fromCharCode(10)),
    [telemetryEvents],
  );

  // The rower's own call on graphics quality, overruling hardware detection
  // when they know better than the heuristic does (#224).
  const graphics = useGraphicsQuality();
  const crew = useCrewPreference();

  // Demo mode: a visitor with no hardware is rowing on simulated device data.
  const [isDemoMode, setIsDemoMode] = useState(false);
  // Session state for the overlay UI
  const [sessionState, setSessionState] = useState<SessionState>('idle');
  // Holds a completed unauthenticated session until the summary modal is dismissed
  const [guestCompletedSession, setGuestCompletedSession] = useState<WorkoutSession | null>(null);
  // The same, for a signed-in athlete — who gets the save controls too (issue #221, R4).
  const [completedSession, setCompletedSession] = useState<WorkoutSession | null>(null);
  // Demo mode is cleared when the session ends, so remember it for the summary.
  const [completedSessionWasDemo, setCompletedSessionWasDemo] = useState(false);
  const [routeEnrichments, setRouteEnrichments] = useState<Record<string, RouteEnrichmentData>>({});
  const [routeEnrichmentLoading, setRouteEnrichmentLoading] = useState<Record<string, boolean>>({});
  // Route import panel state
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [importRouteName, setImportRouteName] = useState('');
  const [importError, setImportError] = useState<string | null>(null);

  // The athlete's default route, if they have set one (issue #219, R6).
  const [defaultRouteId, setDefaultRouteId] = useState<string | null>(null);

  /**
   * Decide which route the app opens on, and which one the star is lit for.
   *
   * Precedence is deep link → stored default → the bundled demo route. The
   * selection is guarded to happen once: this effect depends on `routes`, so
   * without the guard every import re-ran it and snapped the selection back,
   * discarding the route the user had just loaded. `handleRouteImported` and
   * `handleRouteSelect` set the same guard, which is what lets a rownative deep
   * link beat a stored default (AC6.10).
   *
   * The star state is *not* guarded — it has to follow a later sign-in or
   * sign-out. Both jobs read `resolveDefaultRouteId` from this one place so a
   * stale id it clears (AC6.4) can never leave the star lit for a route that no
   * longer exists.
   */
  const hasPreselectedRef = useRef(false);
  useEffect(() => {
    if (routes.length === 0) return;

    const resolved = defaultRoutePreferenceStore.resolveDefaultRouteId(
      user?.id ?? null,
      routes.map((r) => r.id),
    );
    setDefaultRouteId(resolved);

    if (hasPreselectedRef.current || isLoading) return;
    setSelectedRoute(
      (resolved ? routes.find((r) => r.id === resolved) : undefined)
      ?? routes.find((r) => r.id === DEMO_ROUTE_ID)
      ?? routes[0],
    );
    hasPreselectedRef.current = true;
  }, [defaultRoutePreferenceStore, isLoading, routes, user]);

  /** Star / un-star a route as this athlete's default (AC6.5, AC6.6). */
  const handleToggleDefaultRoute = useCallback((routeId: string) => {
    if (!user) return;
    if (defaultRouteId === routeId) {
      defaultRoutePreferenceStore.clearDefaultRouteId(user.id);
      setDefaultRouteId(null);
      return;
    }
    defaultRoutePreferenceStore.setDefaultRouteId(user.id, routeId);
    setDefaultRouteId(routeId);
  }, [defaultRoutePreferenceStore, defaultRouteId, user]);

  // Auto-start/stop the HR simulator for unauthenticated users
  // Skip in Playwright test mode so tests can control HR connection state explicitly.
  useEffect(() => {
    if (isGuestSession) {
      heartRateSimulator.start(130);
    } else {
      heartRateSimulator.stop();
    }
    return () => {
      heartRateSimulator.stop();
    };
  }, [isGuestSession]);

  // Start/stop activity timer when workout state changes
  useEffect(() => {
    if (isWorkoutActive) {
      const startTime = Date.now();
      activityTimerRef.current = window.setInterval(() => {
        setActivityElapsedMs(Date.now() - startTime);
      }, 250);
    } else {
      if (activityTimerRef.current !== null) {
        clearInterval(activityTimerRef.current);
        activityTimerRef.current = null;
      }
      setActivityElapsedMs(0);
    }
    return () => {
      if (activityTimerRef.current !== null) {
        clearInterval(activityTimerRef.current);
        activityTimerRef.current = null;
      }
    };
  }, [isWorkoutActive]);

  useEffect(() => {
    setRoutes(routeService.getAllRoutes());
  }, []);

  useEffect(() => {
    if (!selectedRoute) return;

    let cancelled = false;
    const cached = routeEnrichmentService.readCached(selectedRoute.id);
    const cachedData = cached.data;
    if (cachedData) {
      setRouteEnrichments((current) => ({
        ...current,
        [selectedRoute.id]: cachedData,
      }));
    }

    if (cachedData && !cached.stale) {
      setRouteEnrichmentLoading((current) => ({
        ...current,
        [selectedRoute.id]: false,
      }));
      return;
    }

    setRouteEnrichmentLoading((current) => ({
      ...current,
      [selectedRoute.id]: true,
    }));

    void routeEnrichmentService
      .enrichRoute(selectedRoute)
      .then((enrichment) => {
        if (cancelled) return;
        setRouteEnrichments((current) => ({
          ...current,
          [selectedRoute.id]: enrichment,
        }));
      })
      .finally(() => {
        if (cancelled) return;
        setRouteEnrichmentLoading((current) => ({
          ...current,
          [selectedRoute.id]: false,
        }));
      });

    return () => {
      cancelled = true;
    };
  }, [selectedRoute, routeEnrichmentService]);

  const activeRowerLabel = useMemo(() => (
    activeRowerType === 'pm5' ? 'PM5' : 'FTMS'
  ), [activeRowerType]);
  const selectedRowerConnected = useMemo(() => (
    activeRowerType === 'pm5' ? pm5Connected : ftmsConnected
  ), [activeRowerType, ftmsConnected, pm5Connected]);

  // The structured workout, if one is selected. With none, every flow below is
  // exactly as it was — a free row (#67 §2).
  const structuredWorkout = useStructuredWorkout(selectedRowerConnected);
  // The hook's callbacks are stable; the object around them is not, so pull
  // out the two the memoised handlers below close over.
  const { stop: stopStructuredWorkout, tick: tickStructuredWorkout } = structuredWorkout;

  // Listen to programmatic session events from the workoutService to update UI state
  useEffect(() => {
    const onStartup = (e: Event) => {
      if (!(e instanceof CustomEvent)) return;
      const session = e.detail as WorkoutSession;
      setCurrentSession(session);
      setIsWorkoutActive(true);
      setCurrentView('workout');
      if (session && session.routeId) {
        const r = routeService.getRouteById(session.routeId);
        if (r) setSelectedRoute(r);
      }
    };
    const onEnd = () => {
      finishingRef.current = false;
      setFinish(null);
      strokeSeenRef.current = false;
      setStrokeAt(null);
      setIsWorkoutActive(false);
      setCurrentSession(null);
      setCurrentView('routes');
    };
    if (typeof window === 'undefined') return;
    window.addEventListener('virtualrow:sessionStarted', onStartup as EventListener);
    window.addEventListener('virtualrow:sessionEnded', onEnd as EventListener);
    return () => {
      window.removeEventListener('virtualrow:sessionStarted', onStartup as EventListener);
      window.removeEventListener('virtualrow:sessionEnded', onEnd as EventListener);
    };
  }, []);

  const handleRouteSelect = useCallback((route: WaterRoute) => {
    setSelectedRoute(route);
    // An explicit choice outranks the stored default for the rest of the visit.
    hasPreselectedRef.current = true;
    setCurrentView('routes');
  }, []);

  const selectedRouteEnrichment = selectedRoute ? routeEnrichments[selectedRoute.id] ?? null : null;
  const selectedRouteEnrichmentLoading = selectedRoute ? !!routeEnrichmentLoading[selectedRoute.id] : false;

  // What the rower is waiting for between choosing a route and rowing it
  // (#318). Watched off the performance timeline, so nothing here reaches into
  // the scene's Suspense boundary - see useRouteLoadProgress for why that
  // matters. CREW_URL comes from crewModel.ts, which is free of three and drei
  // precisely so App can name the file without pulling the 3D bundle in.
  const routeLoadProgress = useRouteLoadProgress(
    currentView === 'workout' && isWorkoutActive,
    CREW_URL[resolveCrew(user?.gender, crew.preference)],
  );

  const handleStartWorkout = () => {
    // Guard against double-start (rapid clicks, re-entrant calls, or already-active session)
    if (isStartingSessionRef.current || isWorkoutActive || workoutService.getCurrentSession()) return;
    isStartingSessionRef.current = true;
    try {
      if (!selectedRoute || !selectedRowerConnected || !hrConnected) {
        alert(`Please connect your ${activeRowerLabel} and Heart Rate Monitor, and select a route`);
        return;
      }

      const session = workoutService.startSession(
        selectedRoute.id, 
        selectedRoute.name,
        undefined,
        activeRowerType,
        hrConnected,
        isGuestSession,
        selectedRoute.coordinates,
      );
      // A selected structured workout runs over the top of the session. If it
      // cannot start, the row still goes ahead as a free row and the library
      // shows why (#67 §2, F.3).
      structuredWorkout.start();

      setCurrentSession(session);
      setIsWorkoutActive(true);
      setSessionState('active');
      setCurrentView('workout');
    } finally {
      isStartingSessionRef.current = false;
    }
  };

  /**
   * Start a demo row on simulated devices.
   *
   * Aimed at anyone with no rowing machine to hand: one control connects
   * nothing by hand, starts the rower and heart-rate simulators, and drops
   * straight into the session so the engine can be judged without buying
   * hardware. Offered signed-in as well as signed-out (issue #219, AC7.2) — the
   * session is still flagged as a demo and still not recorded as a real workout.
   */
  const handleStartDemo = useCallback(() => {
    if (isStartingSessionRef.current || isWorkoutActive || workoutService.getCurrentSession()) return;
    if (!selectedRoute) return;
    isStartingSessionRef.current = true;
    try {
      setIsDemoMode(true);
      pm5Simulator.updateSettings({ pace: 120, cadence: 24, heartRate: 130, power: 150, isRowing: true });
      pm5Simulator.start();
      if (!heartRateSimulator.isRunning()) heartRateSimulator.start(130);
      setPM5Connected(true);
      setActiveRowerType('pm5');

      const session = workoutService.startSession(
        selectedRoute.id,
        selectedRoute.name,
        undefined,
        'pm5',
        true,
        isGuestSession,
        selectedRoute.coordinates,
      );
      setCurrentSession(session);
      setIsWorkoutActive(true);
      setSessionState('active');
      setCurrentView('workout');
    } finally {
      isStartingSessionRef.current = false;
    }
  }, [isGuestSession, isWorkoutActive, selectedRoute]);

  const stopDemoDevices = useCallback(() => {
    pm5Simulator.stop();
    setIsDemoMode(false);
    setPM5Connected(false);
    setPM5Data(null);
  }, []);

  const handleEndWorkout = useCallback(() => {
    finishingRef.current = false;
    setFinish(null);
    strokeSeenRef.current = false;
    setStrokeAt(null);
    const completed = workoutService.endSession();
    stopStructuredWorkout();
    setIsWorkoutActive(false);
    setCurrentSession(null);
    setSessionState('idle');
    setCompletedSessionWasDemo(isDemoMode);
    if (isDemoMode) stopDemoDevices();

    if (!completed) {
      setCurrentView('routes');
      return;
    }

    if (isGuestSession) {
      // Show summary modal for unauthenticated sessions
      setGuestCompletedSession(completed);
      return;
    }

    // The row is kept locally before any upload is attempted, so a row the
    // athlete declines to upload — or that fails to — still survives a reload
    // (issue #221, AC6.1).
    if (user) saveCompletedSession(user.id, completed, { isDemo: isDemoMode });
    setCompletedSession(completed);
  }, [isGuestSession, isDemoMode, stopDemoDevices, stopStructuredWorkout, user]);

  /**
   * What this row is being rowed against (#338), chosen before it starts.
   *
   * Rowing alone is the default, which is what the app did before there was
   * anything to race.
   */
  const [ghostChoice, setGhostChoice] = useState<GhostChoice>({ kind: 'none' });

  /** The quickest row this browser kept on the selected route, if any. */
  const bestRowHere = useMemo(() => {
    if (!user || !selectedRoute) return null;
    return bestRowOnRoute(loadSessions(user.id), selectedRoute.id);
  }, [user, selectedRoute]);

  /**
   * The ghost itself: a recorded row, a constant pace, or nothing.
   *
   * Falls back to rowing alone rather than to an empty boat if the best it was
   * told to race has gone - a route changed under the picker, say.
   */
  const ghostSource = useMemo(() => {
    if (ghostChoice.kind === 'pace') return paceGhost(ghostChoice.paceSPer500);
    if (ghostChoice.kind === 'best' && bestRowHere) return recordedGhost(bestRowHere.samples);
    return null;
  }, [ghostChoice, bestRowHere]);

  /** What is being chased, in the words the HUD and the summary both use. */
  const ghostLabel = useMemo(
    () =>
      ghostChoice.kind === 'pace'
        ? `a ${formatSplit(ghostChoice.paceSPer500)} pace`
        : 'your best',
    [ghostChoice],
  );

  /**
   * The row's clock, for the scene.
   *
   * A ref: the ghost is placed every frame, and the erg reports elapsed time
   * about once a second. Kept current during render because it is read by a
   * frame loop rather than by React.
   */
  const elapsedSecondsRef = useRef(0);

  // This athlete's best on the route before this row, from the rows this
  // browser kept for them (#337). None for a demo row, which is not theirs to
  // compare, or without an athlete to ask about.
  const completedSessionBest = useMemo(() => {
    if (!completedSession || !user || completedSessionWasDemo) return undefined;
    return bestPaceOnRoute(loadSessions(user.id), completedSession);
  }, [completedSession, completedSessionWasDemo, user]);

  /**
   * How the race came out (#338).
   *
   * The ghost's time to the distance the row actually covered, so a row cut
   * short is compared at the point it stopped rather than at a finish neither
   * boat reached.
   */
  const completedGhost = useMemo(() => {
    if (!completedSession || !ghostSource) return null;
    return {
      seconds: ghostFinishSeconds(ghostSource, completedSession.distance),
      label: ghostLabel,
    };
  }, [completedSession, ghostSource, ghostLabel]);

  const handleSessionSaved = useCallback((activityId: string) => {
    if (user && completedSession) markSessionUploaded(user.id, completedSession.id, activityId);
  }, [completedSession, user]);

  const handleSessionDone = useCallback(() => {
    setCompletedSession(null);
    setCurrentView('routes');
  }, []);

  const handleGuestRowAgain = useCallback(() => {
    setGuestCompletedSession(null);
    setCurrentView('routes');
  }, []);

  const handleGuestExit = useCallback(() => {
    setGuestCompletedSession(null);
    setCurrentView('routes');
  }, []);

  const handlePauseWorkout = useCallback(() => {
    setSessionState('paused');
    workoutService.pauseSession();
  }, []);

  const handleResumeWorkout = useCallback(() => {
    setSessionState('active');
    workoutService.resumeSession();
  }, []);

  const handleResetWorkout = useCallback(() => {
    // Reset metrics but keep session
    setActivityElapsedMs(0);
    // Note: Full reset logic would need to clear workoutService data
  }, []);

  // Get filtered routes based on current filter settings
  const filteredRoutes = useMemo(() => {
    let filtered = routes;
    if (difficultyFilter !== 'all') {
      filtered = filtered.filter(r => r.difficulty === difficultyFilter);
    }
    return filtered.filter(r => r.distance >= distanceMin && r.distance <= distanceMax);
  }, [routes, difficultyFilter, distanceMin, distanceMax]);

  const handlePM5Data = useCallback((data: PM5Data) => {
    // Always update the service synchronously — no React render triggered here.
    workoutService.updateSessionWithPM5Data(data);

    // The first stroke starts the countdown (#336) from a timer rather than
    // from the frame below: a software renderer draws about a frame a second,
    // and a count that waits for one starts a second late. A timer still runs
    // it from a clean call stack, which is what the frame is for.
    if (isWorkoutActive && !strokeSeenRef.current && isStrokeReading(data)) {
      strokeSeenRef.current = true;
      // Stamped now, so the count runs from the drive however late the page
      // renders it. Unless the row ended in between, which cleared the ref.
      const at = Date.now();
      window.setTimeout(() => {
        if (strokeSeenRef.current) setStrokeAt(at);
      }, 0);
    }

    // Defer React state updates to a requestAnimationFrame so they run from a
    // clean call-stack instead of deep inside the WS→CDP notification chain.
    // This prevents "Maximum call stack size exceeded" overflows during testing.
    pm5DataPendingRef.current = data;
    if (!pm5RafScheduledRef.current) {
      pm5RafScheduledRef.current = true;
      requestAnimationFrame(() => {
        pm5RafScheduledRef.current = false;
        const latest = pm5DataPendingRef.current;
        if (!latest) return;

        setPM5Data(latest);

        // Advance the structured workout, if one is running. No-op otherwise,
        // so a free row is untouched (#67 §4, §5).
        tickStructuredWorkout(latest);

        if (isWorkoutActive) {
          if (latest.heartRate) {
            const updated = workoutService.getCurrentSession();
            setHeartRateSamples(updated?.heartRateSamples ? [...updated.heartRateSamples] : []);
          }
          // Read latest session data directly from the service so mutations (distance,
          // duration, calories) are always reflected — spreading a stale React state
          // copy would freeze distance at whatever value it had on the first spread.
          const latestSession = workoutService.getCurrentSession();
          setCurrentSession(latestSession ? { ...latestSession } : null);

          // Finish when distance reaches route length: the banner, then the
          // summary (#336). Skipped in the Playwright harness, whose rows would
          // otherwise end under specs that are not about the finish, unless a
          // spec asks for it.
          if (
            selectedRoute &&
            typeof window !== 'undefined' &&
            (!window.__PLAYWRIGHT_TESTING || window.__VIRTUALROW_AUTO_FINISH)
          ) {
            const routeDistanceMeters = selectedRoute.distance * 1000;
            const completionThreshold = routeDistanceMeters * 0.995;
            if (latest.distance >= completionThreshold && routeDistanceMeters > 0 && !finishingRef.current) {
              finishingRef.current = true;
              setFinish({
                distanceMeters: routeDistanceMeters,
                elapsedMs: latest.elapsedTime
                  ? latest.elapsedTime * 1000
                  : (latestSession?.duration ?? 0) * 1000,
              });
            }
          }
        }
      });
    }
  }, [isWorkoutActive, selectedRoute, tickStructuredWorkout]);

  // The finish banner stays up for FINISH_BANNER_MS, then the summary opens.
  // Read through a ref so a re-created handler does not restart the wait.
  const handleEndWorkoutRef = useRef(handleEndWorkout);
  useEffect(() => {
    handleEndWorkoutRef.current = handleEndWorkout;
  }, [handleEndWorkout]);
  useEffect(() => {
    if (!finish) return undefined;
    const id = window.setTimeout(() => handleEndWorkoutRef.current(), FINISH_BANNER_MS);
    return () => window.clearTimeout(id);
  }, [finish]);

  /**
   * The light this row is rowed in (#346), remembered between rows. `auto`
   * matches the rower's own clock, which is the default.
   */
  const conditions = useConditions();

  const startSequence = useStartSequence({
    active: isWorkoutActive,
    strokeAt,
    autoStart: isDemoMode,
  });

  /*
   * The count, "Row!", and the line (#339). Here rather than in the scene:
   * these come from the start sequence and the finish, both of which live on
   * this side of the canvas.
   */
  useRaceCues(audioService, startSequence.phase, startSequence.countdown, finish !== null);

  // While the demo is running, simulated rower data flows through exactly the
  // same pipeline as a real PM5, so nothing downstream needs to know it is fake.
  useEffect(() => {
    if (!isDemoMode) return;
    pm5Simulator.addListener(handlePM5Data);
    return () => pm5Simulator.removeListener(handlePM5Data);
  }, [isDemoMode, handlePM5Data]);

  // Expose PM5 data on window for E2E tests to inspect cadence / pace
  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.__PM5_DATA = pm5Data ?? undefined;
    }
  }, [pm5Data]);

  const handleHeartRateSample = useCallback((_bpm: number) => {
    if (isWorkoutActive) {
      requestAnimationFrame(() => {
        const session = workoutService.getCurrentSession();
        setHeartRateSamples(session?.heartRateSamples ? [...session.heartRateSamples] : []);
        setCurrentSession(session ? { ...session } : null);
      });
    }
  }, [isWorkoutActive]);

  // Persistent HR listener — HeartRateMonitor is only mounted on the 'routes' view, so
  // its listener is cleaned up when the workout starts and the view switches.  This effect
  // stays alive for the lifetime of the App and ensures HR samples are written to the
  // workout session regardless of which view is active.
  useEffect(() => {
    const onHR = ({ bpm }: { bpm: number }) => {
      // Always update the service synchronously; defer state updates to RAF.
      if (isProcessingHrUpdateRef.current) return;
      isProcessingHrUpdateRef.current = true;
      try {
        workoutService.updateSessionHeartRate(bpm);
      } finally {
        isProcessingHrUpdateRef.current = false;
      }
      requestAnimationFrame(() => {
        const session = workoutService.getCurrentSession();
        setHeartRateSamples(session?.heartRateSamples ? [...session.heartRateSamples] : []);
      });
    };
    heartRateBluetoothService.on('heartRate', onHR);
    return () => heartRateBluetoothService.off('heartRate', onHR);
  }, []);

  // Track HR monitor connectivity for the lifetime of the app
  useEffect(() => {
    const onConnected = () => requestAnimationFrame(() => setHrConnected(true));
    const onDisconnected = () => requestAnimationFrame(() => setHrConnected(false));
    heartRateBluetoothService.on('connected', onConnected);
    heartRateBluetoothService.on('disconnected', onDisconnected);
    return () => {
      heartRateBluetoothService.off('connected', onConnected);
      heartRateBluetoothService.off('disconnected', onDisconnected);
    };
  }, []);

  const handleHrConnected = useCallback(() => setHrConnected(true), []);
  const handleHrDisconnected = useCallback(() => setHrConnected(false), []);

  // Connection state updates are deferred to RAF for the same reason as the PM5 data
  // above: these now run directly on the BLE notification stack.
  const handlePM5Connected = useCallback(() => {
    requestAnimationFrame(() => setPM5Connected(true));
  }, []);

  const handlePM5Disconnected = useCallback(() => {
    requestAnimationFrame(() => setPM5Connected(false));
  }, []);

  const handleFtmsConnected = useCallback(() => {
    requestAnimationFrame(() => setFtmsConnected(true));
  }, []);

  const handleFtmsDisconnected = useCallback(() => {
    requestAnimationFrame(() => setFtmsConnected(false));
  }, []);

  // FTMS data arrives in the same PM5Data shape; merge into shared rower data state
  const handleFtmsData = useCallback((data: PM5Data) => {
    // Re-use the PM5 data pipeline so all workout tracking works regardless of device type
    handlePM5Data(data);
  }, [handlePM5Data]);

  // Only the selected rower drives the session. Both services stay subscribed for the
  // lifetime of the app, so without this a PM5 left connected while FTMS is selected
  // (or vice versa) would interleave a second device's frames into the same session.
  const activeRowerTypeRef = useRef(activeRowerType);
  useEffect(() => {
    activeRowerTypeRef.current = activeRowerType;
  }, [activeRowerType]);

  const handleSelectedPM5Data = useCallback((data: PM5Data) => {
    if (activeRowerTypeRef.current !== 'pm5') return;
    handlePM5Data(data);
  }, [handlePM5Data]);

  const handleSelectedFtmsData = useCallback((data: PM5Data) => {
    if (activeRowerTypeRef.current !== 'ftms') return;
    handleFtmsData(data);
  }, [handleFtmsData]);

  // Persistent rower listeners. BluetoothDevice / FTMSDevice render only on the routes
  // view, so subscribing from there stopped every frame the instant a workout started
  // and the view switched to 'workout' — the session then recorded 0 m for the whole
  // row. These subscriptions outlive the view switch.
  useRowerServiceEvents(bluetoothService, {
    onData: handleSelectedPM5Data,
    onConnected: handlePM5Connected,
    onDisconnected: handlePM5Disconnected,
  });

  useRowerServiceEvents(ftmsBluetoothService, {
    onData: handleSelectedFtmsData,
    onConnected: handleFtmsConnected,
    onDisconnected: handleFtmsDisconnected,
  });

  // Playwright reads this to compare the card's distance with the engine's own
  // total; it is never set in a normal session.
  useEffect(() => {
    if (!window.__PLAYWRIGHT_TESTING) return;
    window.__SELECTED_ROUTE = selectedRoute
      ? {
        id: selectedRoute.id,
        name: selectedRoute.name,
        distanceKm: selectedRoute.distance,
        geometrySource: selectedRoute.geometrySource,
        externalDistanceMeters: selectedRoute.externalDistanceMeters,
      }
      : undefined;
  }, [selectedRoute]);

  const handleRouteImported = useCallback((route: WaterRoute) => {
    setRoutes(routeService.getAllRoutes());
    setSelectedRoute(route);
    // A deep-linked or freshly imported course outranks the stored default
    // for this page load (issue #219, AC6.10).
    hasPreselectedRef.current = true;
    setCurrentView('routes');
  }, []);

  // Deep link: if the app was opened with ?rownativeCourseId=<id>, load that
  // course and select it. Held until auth resolves so a shared link survives a
  // sign-in round trip.
  const { status: handoffStatus, dismiss: dismissHandoff } = useRownativeDeepLink({
    onRouteLoaded: handleRouteImported,
    isReady: !isLoading,
  });

  /**
   * Import a route file, dispatching on its type.
   *
   * This used to parse whatever was chosen as JSON, so a .gpx or .kml drop —
   * both offered by the file picker — silently did nothing (issue #194 F7).
   */
  const handleRouteFileImport = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportError(null);

    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const fallbackName = importRouteName.trim() || file.name.replace(/\.[^.]+$/, '');
      const format = detectTrackFormat(file.name);

      try {
        if (!format) {
          throw new TrackParseError(
            `${file.name} is not a route file VirtualRow can read. Use a .gpx, .kml or .geojson file.`,
          );
        }

        let imported: WaterRoute | undefined;
        if (format === 'gpx') {
          imported = routeService.importRouteFromGPX(text, {
            name: fallbackName,
            difficulty: 'moderate',
            location: 'Imported',
            tags: ['imported', 'gpx'],
          });
        } else if (format === 'kml') {
          const result = routeService.importRouteFromKML(text, {
            name: importRouteName.trim() || undefined,
            difficulty: 'moderate',
            tags: ['imported', 'kml'],
          });
          if (result.status === 'error') throw new TrackParseError(result.error);
          if (result.status === 'selectionRequired') {
            imported = routeService.finalizeKMLImport(result.candidates[0], {
              name: importRouteName.trim() || undefined,
              difficulty: 'moderate',
              tags: ['imported', 'kml'],
            });
          } else {
            imported = result.route;
          }
        } else {
          const parsed = JSON.parse(text) as { properties?: { name?: string; country?: string } };
          imported = routeService.importRouteFromGeoJSON(text, {
            name: importRouteName.trim() || parsed?.properties?.name || fallbackName,
            difficulty: 'moderate',
            location: parsed?.properties?.country ?? 'Imported',
            tags: ['imported', 'geojson'],
          });
        }

        if (!imported) {
          throw new TrackParseError(`${file.name} has no route line with at least 2 points.`);
        }

        handleRouteImported(imported);
        setIsImportOpen(false);
        setImportRouteName('');
        e.target.value = '';
      } catch (error) {
        setImportError(
          error instanceof Error ? error.message : `${file.name} could not be imported.`,
        );
      }
    };
    reader.readAsText(file);
  }, [importRouteName, handleRouteImported]);
  const latestHeartRate = useMemo(() => (
    heartRateSamples.length > 0
      ? heartRateSamples[heartRateSamples.length - 1].bpm
      : (pm5Data?.heartRate ?? null)
  ), [heartRateSamples, pm5Data]);
  /**
   * Sound, off until a rower asks for it (#339).
   *
   * A browser will not start an AudioContext without a gesture, so this is not
   * a preference the app can honour quietly at load - the switch is the
   * gesture. The volume is kept here so it survives switching the sound off
   * and on again.
   */
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [soundVolume, setSoundVolume] = useState(() => audioService.getVolume());

  const handleSoundToggle = useCallback(
    (enabled: boolean) => {
      setSoundEnabled(enabled);
      void (enabled ? audioService.enable() : audioService.disable());
    },
    [audioService],
  );

  const handleSoundVolume = useCallback(
    (volume: number) => {
      setSoundVolume(volume);
      audioService.setVolume(volume);
    },
    [audioService],
  );

  /**
   * The water bed runs with the row, not with the page.
   *
   * A loop that started when the sound was switched on would play under the
   * route list and the settings panel, which are not on the water.
   */
  useEffect(() => {
    if (!soundEnabled || !isWorkoutActive) {
      audioService.stopWater();
      return;
    }
    audioService.startWater();
    return () => audioService.stopWater();
  }, [audioService, soundEnabled, isWorkoutActive]);

  const workoutElapsedTimeMs = useMemo(() => (
    pm5Data?.elapsedTime ? pm5Data.elapsedTime * 1000 : activityElapsedMs
  ), [activityElapsedMs, pm5Data]);
  elapsedSecondsRef.current = workoutElapsedTimeMs / 1000;

  /**
   * How hard the strokes are landing, for how loud they sound (#339).
   *
   * From the power, because that is what the stroke actually cost: a light
   * paddle and a racing catch are the same sound at different volumes, and a
   * constant would make every stroke sound like the same stroke. Floored, so a
   * quiet row is quiet rather than silent.
   */
  const strokeIntensity = useMemo(() => {
    const watts = pm5Data?.power ?? 0;
    return Math.min(1, Math.max(0.2, watts / 300));
  }, [pm5Data?.power]);

  /**
   * The gap to the ghost, for the HUD (#338).
   *
   * Null until the row has actually started: two boats on the start line have
   * no gap worth reading, and "level" before the first stroke is noise.
   */
  const ghostGap = useMemo(() => {
    if (!ghostSource) return null;
    const rowerMeters = pm5Data?.distance ?? 0;
    const started = workoutElapsedTimeMs > 0 && rowerMeters > 0;
    return {
      gapMeters: started
        ? gapMeters(rowerMeters, ghostDistanceAt(ghostSource, workoutElapsedTimeMs / 1000))
        : null,
      label: ghostLabel,
    };
  }, [ghostSource, ghostLabel, pm5Data?.distance, workoutElapsedTimeMs]);
  const activityProgressPercent = useMemo(() => (
    pm5Data && selectedRoute
      ? Math.min(100, (pm5Data.distance / 1000) / selectedRoute.distance * 100)
      : 0
  ), [pm5Data, selectedRoute]);

  return (
    <div className="app-container">
      {guestCompletedSession && (
        <GuestSessionSummary
          session={guestCompletedSession}
          onRowAgain={handleGuestRowAgain}
          onExit={handleGuestExit}
          onSignIn={login}
          isDemo={completedSessionWasDemo}
        />
      )}

      {completedSession && (
        <SessionSummary
          session={completedSession}
          onDone={handleSessionDone}
          onSaved={handleSessionSaved}
          isDemo={completedSessionWasDemo}
          personalBest={completedSessionBest}
          ghost={completedGhost}
        />
      )}

      <header className="app-header">
        <div className="header-content">
          <h1 className="app-title">VirtualRow</h1>

          {/* The nav stands down during a workout, as the device bar does
              (issue #219, AC8.4). */}
          {!isWorkoutActive && (
            <>
              <button
                type="button"
                className="nav-toggle"
                aria-label="Menu"
                aria-expanded={isNavOpen}
                aria-controls="nav-overlay"
                onClick={() => setIsNavOpen((open) => !open)}
              >
                <span /><span /><span />
              </button>
              <div className="nav-overlay" id="nav-overlay" data-open={isNavOpen}>
                <button
                  type="button"
                  className="nav-overlay-backdrop"
                  aria-label="Close menu"
                  onClick={() => setIsNavOpen(false)}
                />
                <nav className="app-nav" aria-label="Main">
                  {NAV_ITEMS.map(({ view, label }) => (
                    <button
                      key={view}
                      type="button"
                      className={`nav-tab${currentView === view ? ' active' : ''}`}
                      aria-current={currentView === view ? 'page' : undefined}
                      onClick={() => {
                        setCurrentView(view);
                        setIsNavOpen(false);
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </nav>
              </div>
            </>
          )}

          <div className="header-auth">
            <AuthButton />
          </div>
        </div>
        {!isAuthenticated && (
          <p className="signed-out-notice">
            You are rowing as a guest — sessions are not saved. Sign in with intervals.icu to keep them.
          </p>
        )}
      </header>

      <div className={`app-layout app-layout--${currentView}`}>
        <aside
          className={[
            'app-sidebar',
            isWorkoutActive && currentView === 'workout' && !window.__PLAYWRIGHT_TESTING
              ? 'app-sidebar--hidden'
              : '',
          ].filter(Boolean).join(' ')}
        >
          {currentView === 'routes' && (
            <div className="routes-devices-row">
              <div className="device-panel device-panel--selection">
                <div className="device-panel-heading">
                  <h3 className="panel-title">Rower Device</h3>
                  <span className={`device-panel-status ${selectedRowerConnected ? 'connected' : 'disconnected'}`}>
                    {selectedRowerConnected ? 'Connected' : 'Not connected'}
                  </span>
                </div>
                <div className="device-selector-tabs" role="tablist" aria-label="Rower type">
                  <button
                    className={`device-selector-tab ${activeRowerType === 'pm5' ? 'active' : ''}`}
                    onClick={() => setActiveRowerType('pm5')}
                    type="button"
                  >
                    PM5
                  </button>
                  <button
                    className={`device-selector-tab ${activeRowerType === 'ftms' ? 'active' : ''}`}
                    onClick={() => setActiveRowerType('ftms')}
                    type="button"
                  >
                    FTMS
                  </button>
                </div>
                {activeRowerType === 'pm5' ? <BluetoothDevice /> : <FTMSDevice />}
              </div>
              <div className="device-panel">
                <HeartRateMonitor
                  onSample={handleHeartRateSample}
                  onConnected={handleHrConnected}
                  onDisconnected={handleHrDisconnected}
                />
              </div>
            </div>
          )}

        </aside>

        <main className="app-main">
          {/* -- Row screen ---------------------------------------------
              One route, its map, and the two ways to start it. Everything to do
              with finding a different route lives on the Routes screen
              (issue #219, R2). */}
          {currentView === 'routes' && selectedRoute && (
            <div className="view-container view-container--routes">
              <div className="map-container">
                <RouteMap route={selectedRoute} />
              </div>
              <div className="route-details-panel">
                {handoffStatus.kind !== 'idle' && handoffStatus.kind !== 'loaded' && (
                  <div
                    className={`rownative-handoff-banner rownative-handoff-banner--${handoffStatus.kind}`}
                    role={handoffStatus.kind === 'error' ? 'alert' : 'status'}
                  >
                    {handoffStatus.kind === 'loading'
                      ? `Loading rownative course ${handoffStatus.courseId}...`
                      : handoffStatus.message}
                    {handoffStatus.kind === 'error' && (
                      <button type="button" className="rownative-handoff-dismiss" onClick={dismissHandoff}>
                        Dismiss
                      </button>
                    )}
                  </div>
                )}

                <div className="route-info-overlay">
                  <div className="route-info-header">
                    <h2>{selectedRoute.name}</h2>
                    <p className="route-location">📍 {selectedRoute.location}</p>
                  </div>

                  <div className="route-meta-compact">
                    <span className="meta-badge">
                      📏 {formatRouteDistanceKm(selectedRoute.distance)}
                    </span>
                    {externalDistanceNote(selectedRoute) && (
                      <span
                        className="meta-badge meta-badge--external-distance"
                        title="rownative measures a course as straight lines between its gates, so it reads short on a course that bends."
                      >
                        {externalDistanceNote(selectedRoute)}
                      </span>
                    )}
                    <span className="meta-badge">
                      ⏱️ {selectedRoute.estimatedTime} min
                    </span>
                    <span className={`meta-badge badge-${selectedRoute.difficulty}`}>
                      {selectedRoute.difficulty}
                    </span>
                    {(() => {
                      const badge = geometryProvenanceBadge(routeGeometrySource(selectedRoute));
                      return badge && (
                        <span className={`meta-badge meta-badge--${badge.modifier}`} title={badge.title}>
                          {badge.label}
                        </span>
                      );
                    })()}
                  </div>

                  <div className="route-tags">
                    {selectedRoute.tags.map((tag) => (
                      <span key={tag} className="tag">
                        {tag}
                      </span>
                    ))}
                  </div>

                  {selectedRouteEnrichmentLoading && (
                    <p className="route-enrichment-status">Loading route data…</p>
                  )}

                  {/* Decided before the row, not during it (#338). */}
                  <GhostPicker
                    value={ghostChoice}
                    onChange={setGhostChoice}
                    hasBest={bestRowHere !== null}
                    bestPace={bestRowHere?.averagePace ?? null}
                  />

                  <button
                    className="btn btn-start-workout"
                    onClick={handleStartWorkout}
                    disabled={!selectedRowerConnected || !hrConnected}
                  >
                    {selectedRowerConnected && hrConnected
                      ? '▶ Start Workout'
                      : !selectedRowerConnected
                        ? `⚠ Connect ${activeRowerLabel} First`
                        : '⚠ Connect HR Monitor First'}
                  </button>

                  {/* The single door to route discovery (issue #219, AC2.2). */}
                  <button
                    className="btn btn-change-route"
                    type="button"
                    onClick={() => setCurrentView('route-search')}
                  >
                    Change route
                  </button>

                  {/* Offered to everyone, not only guests (issue #219, AC7.2). */}
                  <div className="demo-row-cta">
                    <button
                      className="btn btn-try-demo"
                      onClick={handleStartDemo}
                      type="button"
                    >
                      ▶ Try a demo row — no rowing machine needed
                    </button>
                    <p className="demo-row-note">
                      Rows this route on simulated rower and heart-rate data, so you can see how it
                      feels before connecting anything.
                    </p>
                  </div>

                  <GraphicsQualityPicker
                    quality={graphics.quality}
                    onChange={graphics.setQuality}
                  />

                  {/* The same kind of decision as the tier above it: set once,
                      changing how every row looks (#346). */}
                  <ConditionsPicker
                    choice={conditions.choice}
                    resolved={conditions.conditions}
                    onChange={conditions.setChoice}
                  />

                  <SoundPicker
                    enabled={soundEnabled}
                    volume={soundVolume}
                    onToggle={handleSoundToggle}
                    onVolume={handleSoundVolume}
                  />

                  <CrewPicker
                    preference={crew.preference}
                    onChange={crew.setPreference}
                  />
                </div>
              </div>
            </div>
          )}

          {/* -- Routes screen ------------------------------------------------
              Course ID first, then search by name, then the local catalogue,
              then file import behind a disclosure (issue #219, R3). */}
          {currentView === 'route-search' && (
            <div className="view-container view-container--search">
              <div className="route-search-screen">
                <div className="route-search-header">
                  <h2>Routes</h2>
                  <button
                    type="button"
                    className="btn-back-to-row"
                    onClick={() => setCurrentView('routes')}
                  >
                    ← Back to Row
                  </button>
                </div>

                <section className="route-search-section">
                  <h3>Add a rownative course</h3>
                  {showAuthFeatures ? (
                    <>
                      <p className="route-search-hint">
                        Paste a course ID or a rownative.icu link to add it straight away, or
                        search the catalogue by name.
                      </p>
                      <RownativeRouteImport onRouteImported={handleRouteImported} />
                    </>
                  ) : (
                    <p className="route-search-hint">
                      Sign in with intervals.icu to import courses from rownative.icu.
                    </p>
                  )}
                </section>

                <section className="route-search-section routes-list">
                  <div className="routes-list-header">
                    <h3>My routes</h3>
                    <div className="route-filters">
                      <div className="filter-group">
                        {(['all', 'easy', 'moderate', 'hard'] as const).map((d) => (
                          <button
                            key={d}
                            type="button"
                            className={`filter-btn${difficultyFilter === d ? ' filter-btn--active' : ''}`}
                            onClick={() => setDifficultyFilter(d)}
                          >
                            {d === 'all' ? 'All' : d.charAt(0).toUpperCase() + d.slice(1)}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                  {filteredRoutes.map((route) => {
                    const rownativeStatus = extractRouteStatus(route.tags);
                    const isDefault = defaultRouteId === route.id;
                    return (
                      <div
                        key={route.id}
                        className={`route-item ${selectedRoute?.id === route.id ? 'active' : ''}`}
                        onClick={() => handleRouteSelect(route)}
                      >
                        <div className="route-item-header">
                          <h4>{route.name}</h4>
                          <div className="route-item-badges">
                            {isDefault && (
                              <span className="badge route-default-badge">Default</span>
                            )}
                            <span className={`badge badge-${route.difficulty}`}>
                              {route.difficulty}
                            </span>
                            {route.source === 'rownative' && (
                              <span className="badge badge-source">rownative.icu</span>
                            )}
                            {rownativeStatus && (
                              <span className={`badge badge-status badge-status--${rownativeStatus}`}>
                                {rownativeStatus.charAt(0).toUpperCase() + rownativeStatus.slice(1)}
                              </span>
                            )}
                            {(() => {
                              const badge = geometryProvenanceBadge(routeGeometrySource(route));
                              return badge && (
                                <span className={`badge badge-${badge.modifier}`} title={badge.title}>
                                  {badge.label}
                                </span>
                              );
                            })()}
                          </div>
                        </div>
                        <p className="route-item-location">{route.location}</p>
                        <div className="route-item-meta">
                          <span>{formatRouteDistanceKm(route.distance)}</span>
                          <span>•</span>
                          <span>{route.estimatedTime} min</span>
                          {externalDistanceNote(route) && (
                            <>
                              <span>•</span>
                              <span className="route-item-external-distance">{externalDistanceNote(route)}</span>
                            </>
                          )}
                        </div>
                        {route.coordinates && route.coordinates.length >= 2 && (
                          <RouteThumbnail
                            coordinates={route.coordinates}
                            width={120}
                            height={60}
                            className="route-item-thumbnail"
                          />
                        )}
                        {routeEnrichmentLoading[route.id] && (
                          <p className="route-item-status">Loading route data…</p>
                        )}
                        {isAuthenticated && (
                          <button
                            type="button"
                            className={`route-default-toggle${isDefault ? ' route-default-toggle--on' : ''}`}
                            aria-pressed={isDefault}
                            onClick={(e) => {
                              // The card itself selects the route; the star must not.
                              e.stopPropagation();
                              handleToggleDefaultRoute(route.id);
                            }}
                          >
                            {isDefault ? '★ Remove as default' : '☆ Set as default'}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </section>

                {showAuthFeatures && (
                  <section className="route-search-section route-file-import">
                    <button
                      type="button"
                      className="btn-import-route"
                      aria-expanded={isImportOpen}
                      aria-controls="route-file-import-body"
                      onClick={() => setIsImportOpen((o) => !o)}
                    >
                      Import a file (GPX / KML / GeoJSON)
                    </button>
                    {isImportOpen && (
                      <div className="route-import" id="route-file-import-body">
                        <label htmlFor="import-route-name">Route name</label>
                        <input
                          id="import-route-name"
                          type="text"
                          className="import-name-input"
                          placeholder="Route name"
                          value={importRouteName}
                          onChange={(e) => setImportRouteName(e.target.value)}
                        />
                        <input
                          type="file"
                          accept=".geojson,.json,.gpx,.kml"
                          aria-label="Route file"
                          onChange={handleRouteFileImport}
                        />
                        {importError && (
                          <p className="import-error" role="alert">⚠ {importError}</p>
                        )}
                      </div>
                    )}
                  </section>
                )}
              </div>
            </div>
          )}

          {currentView === 'workouts' && (
            <div className="view-container view-container--workouts">
              <WorkoutLibrary
                library={structuredWorkout.library}
                selected={structuredWorkout.selected}
                onSelect={structuredWorkout.select}
                validationErrors={structuredWorkout.validationErrors}
                onImport={structuredWorkout.importFromIntervalsIcu}
                canUseSession={structuredWorkout.canUseIntervalsIcuSession}
                plannedWorkouts={structuredWorkout.plannedWorkouts}
                plannedLoading={structuredWorkout.plannedLoading}
                plannedError={structuredWorkout.plannedError}
                onLoadPlanned={structuredWorkout.loadPlannedWorkouts}
                onAddPlanned={structuredWorkout.addPlannedWorkout}
              />
              <button
                className="btn btn-back-to-row"
                type="button"
                onClick={() => setCurrentView('routes')}
              >
                Back to Row
              </button>
            </div>
          )}

          {currentView === 'workout' && isWorkoutActive && currentSession && (
            <div
              className={`view-container activity-view${
                rowFullscreen.active && !rowFullscreen.supported ? ' activity-view--fullscreen' : ''
              }`}
            >
              <div className="activity-screen">
                <div className="activity-route-stage" ref={rowStageRef}>
                  {/* How much of the wait is done, and gone when it really
                      is (#318). The Suspense fallback below covers only the
                      code chunk, which arrives 0.7s into a 3.2s load; the bar
                      sits over the stage for the whole of it. */}
                  <RouteLoadingBar progress={routeLoadProgress} />

                  <Suspense fallback={null}>
                    <Rower3D
                      route={selectedRoute!}
                      enrichment={selectedRouteEnrichment}
                      paceSPer500={pm5Data?.pace ? pm5Data.pace : undefined}
                      distanceMeters={pm5Data?.distance}
                      isPlaying={isWorkoutActive && sessionState === 'active'}
                      holdBoat={startSequence.holdBoat}
                      finished={finish !== null}
                      cadence={pm5Data?.cadence}
                      performanceMode={graphics.performanceMode ?? resolvePerformanceMode()}
                      intensityFactor={structuredWorkout.speedFactor}
                      debugMode={debugMode}
                      showRiverGuides={showRiverGuides}
                      sceneryEnabled={sceneryEnabled}
                      crew={resolveCrew(user?.gender, crew.preference)}
                      ghost={ghostSource}
                      elapsedSecondsRef={elapsedSecondsRef}
                      audio={audioService}
                      strokeIntensity={strokeIntensity}
                      sceneConfig={conditions.sceneConfig}
                    />
                  </Suspense>

                  {structuredWorkout.selected && structuredWorkout.progress && (
                    <WorkoutOverlay
                      workout={structuredWorkout.selected}
                      segments={structuredWorkout.segments}
                      progress={structuredWorkout.progress}
                      deviceConnected={selectedRowerConnected}
                    />
                  )}

                  <div className="activity-route-summary">
                    <h2>{selectedRoute?.name}</h2>
                    <p>{selectedRoute?.location}</p>
                    {isDemoMode && (
                      <p className="activity-demo-badge" role="status">
                        Demo row — simulated data, not a recorded workout
                      </p>
                    )}
                  </div>

                  <div className="activity-map-overlay">
                    <RouteMap 
                      route={selectedRoute!} 
                      highlightMode={true}
                      progressPercent={activityProgressPercent}
                    />
                  </div>

                  {finish ? (
                    <FinishBanner distanceMeters={finish.distanceMeters} elapsedMs={finish.elapsedMs} />
                  ) : (
                    <StartCallout phase={startSequence.phase} countdown={startSequence.countdown} />
                  )}

                  {/* On the stage, not under it (#335). Last inside the stage
                      so it layers over the canvas and the two overlays without
                      needing a z-index taller than either. */}
                  <RowHud
                    paceSecondsPer500={pm5Data?.pace ?? null}
                    strokeRate={pm5Data?.cadence ?? null}
                    power={pm5Data?.power ?? null}
                    heartRate={latestHeartRate ?? null}
                    distanceMeters={currentSession.distance}
                    elapsedMs={workoutElapsedTimeMs}
                    paused={sessionState === 'paused'}
                    onPause={handlePauseWorkout}
                    onResume={handleResumeWorkout}
                    onReset={handleResetWorkout}
                    onEnd={handleEndWorkout}
                    fullscreen={rowFullscreen}
                    ghost={ghostGap}
                  />
                </div>

              </div>
            </div>
          )}

        </main>
      </div>

      {/* Debug Panel - Global, appears on all views */}
      <div className="debug-panel-toggle">
        <button 
          className={`btn-debug-toggle ${debugMode ? 'active' : ''}`}
          onClick={() => setDebugMode(!debugMode)}
          title="Toggle Debug Mode"
        >
          🐛 Debug
        </button>
      </div>

      {/* Debug Info Panel - only visible when debugMode is on */}
      {debugMode && (
        <div className="debug-info-panel">
          <div className="debug-panel-header">
            <h4>🔧 Debug Mode</h4>
            <button className="debug-close-btn" onClick={() => setDebugMode(false)}>✕</button>
          </div>
          
          {/* PM5 Simulator Controls */}
          <div className="debug-section debug-simulator-section">
            <h5>PM5 Simulator</h5>
            <PM5Simulator
              onConnected={handlePM5Connected}
              onDisconnected={handlePM5Disconnected}
              onDataReceived={handlePM5Data}
            />
          </div>

          {/* Heart Rate Simulator Controls */}
          <div className="debug-section debug-simulator-section">
            <h5>Heart Rate Simulator</h5>
            <HeartRateSimulator />
          </div>
          
          <div className="debug-section">
            <h5>Overlays</h5>
            <label className="debug-toggle-row">
              <input
                type="checkbox"
                checked={showRiverGuides}
                onChange={(e) => setShowRiverGuides(e.target.checked)}
              />
              <span>River guides</span>
            </label>
            <label className="debug-toggle-row">
              <input
                type="checkbox"
                checked={sceneryEnabled}
                onChange={(e) => setSceneryEnabled(e.target.checked)}
              />
              <span>GLB scenery kit</span>
            </label>
          </div>

          <div className="debug-section">
            <h5>Scene</h5>
            <table className="debug-table">
              <tbody>
                {renderStats.stats ? (
                  <>
                    {/* Against the budget CI holds, not on its own: a draw
                        call count means nothing without the line it is near
                        (#342). The breached axes are named in red so the panel
                        answers the same question the gate does. */}
                    <tr className={overBudget(renderStats.stats.performanceMode as PerformanceMode, { drawCalls: renderStats.stats.drawCalls }).length ? 'debug-over-budget' : undefined}>
                      <td>Draw calls:</td>
                      <td>{renderStats.stats.drawCalls} / {RENDER_BUDGET[renderStats.stats.performanceMode as PerformanceMode]?.drawCalls ?? '—'}</td>
                    </tr>
                    <tr className={overBudget(renderStats.stats.performanceMode as PerformanceMode, { triangles: renderStats.stats.triangles }).length ? 'debug-over-budget' : undefined}>
                      <td>Triangles:</td>
                      <td>{renderStats.stats.triangles.toLocaleString()} / {RENDER_BUDGET[renderStats.stats.performanceMode as PerformanceMode]?.triangles.toLocaleString() ?? '—'}</td>
                    </tr>
                    <tr><td>FPS:</td><td>{renderStats.stats.fps?.toFixed(1) ?? 'N/A'}</td></tr>
                    <tr className={overBudget(renderStats.stats.performanceMode as PerformanceMode, { p95Ms: renderStats.stats.p95Ms }).length ? 'debug-over-budget' : undefined}>
                      <td>Frame p95 (ms):</td>
                      <td>{renderStats.stats.p95Ms?.toFixed(1) ?? 'N/A'} / {RENDER_BUDGET[renderStats.stats.performanceMode as PerformanceMode]?.p95Ms ?? '—'}</td>
                    </tr>
                    <tr><td>Drawing with:</td><td>{renderStats.stats.drawing}</td></tr>
                    <tr><td>Backend detected:</td><td>{renderStats.stats.backend}</td></tr>
                    <tr><td>Quality:</td><td>{renderStats.stats.performanceMode}</td></tr>
                    <tr>
                      <td>Drawing:</td>
                      <td>{renderStats.stalled ? '⚠️ stalled — no recent frame' : '✅ yes'}</td>
                    </tr>
                  </>
                ) : (
                  <tr><td>Drawing:</td><td>❌ the 3D scene has not drawn a frame</td></tr>
                )}
                {renderStats.context && (
                  <>
                    <tr><td>GPU adapter:</td><td>{renderStats.context.powerPreference}</td></tr>
                    <tr><td>Antialias:</td><td>{renderStats.context.antialias ? 'on' : 'off'}</td></tr>
                    <tr>
                      <td>Context:</td>
                      <td>
                        {renderStats.context.lost
                          ? `⚠️ lost${renderStats.context.lostReason ? ` — ${renderStats.context.lostReason}` : ''}`
                          : `✅ live${renderStats.context.losses > 0 ? ` (recovered ${renderStats.context.losses}×)` : ''}`}
                      </td>
                    </tr>
                    {renderStats.context.fallbackReason && (
                      <tr><td>Fell back because:</td><td>{renderStats.context.fallbackReason}</td></tr>
                    )}
                  </>
                )}
              </tbody>
            </table>
          </div>

          <div className="debug-section">
            <h5>Scene telemetry</h5>
            {/* What the scene has been doing, kept in session storage so it
                survives the reload a killed renderer produces - which is the
                one case where every other reading has already gone. */}
            <p>
              {telemetryCount} event{telemetryCount === 1 ? '' : 's'} recorded this tab.
              {' '}Kept in session storage; cleared when the tab closes.
            </p>
            <div className="debug-telemetry-actions">
              <button
                type="button"
                className="btn btn-debug-action"
                onClick={() => {
                  const text = telemetryAsText();
                  navigator.clipboard?.writeText(text).catch(() => {
                    // Clipboard refused. The download below still works.
                  });
                }}
              >
                Copy
              </button>
              <button
                type="button"
                className="btn btn-debug-action"
                onClick={() => {
                  const blob = new Blob([telemetryAsText()], { type: 'text/plain' });
                  const url = URL.createObjectURL(blob);
                  const link = document.createElement('a');
                  link.href = url;
                  link.download = `virtualrow-telemetry-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.txt`;
                  link.click();
                  URL.revokeObjectURL(url);
                }}
              >
                Download
              </button>
              <button
                type="button"
                className="btn btn-debug-action"
                onClick={() => {
                  clearTelemetry();
                  setTelemetryTick((n) => n + 1);
                }}
              >
                Clear
              </button>
            </div>
            <pre className="debug-telemetry-log">{recentTelemetry}</pre>
          </div>

          <div className="debug-section">
            <h5>PM5 Data (Live)</h5>
            <table className="debug-table">
              <tbody>
                <tr><td>Connected:</td><td>{pm5Connected ? '✅ Yes' : '❌ No'}</td></tr>
                <tr><td>Pace (s/500m):</td><td>{pm5Data?.pace ?? 'N/A'}</td></tr>
                <tr><td>Speed (m/s):</td><td>{pm5Data?.pace ? (500 / pm5Data.pace).toFixed(2) : 'N/A'}</td></tr>
                
                <tr><td>Distance (m):</td><td>{pm5Data?.distance?.toFixed(1) ?? 'N/A'}</td></tr>
                <tr><td>Elapsed (s):</td><td>{pm5Data?.elapsedTime ?? 'N/A'}</td></tr>
                <tr><td>Cadence (spm):</td><td>{pm5Data?.cadence ?? 'N/A'}</td></tr>
                <tr><td>Power (W):</td><td>{pm5Data?.power ?? 'N/A'}</td></tr>
                <tr><td>Heart Rate:</td><td>{pm5Data?.heartRate ?? 'N/A'}</td></tr>
              </tbody>
            </table>
          </div>
          
          {currentView === 'workout' && (
            <div className="debug-section">
              <h5>Route Visualization (3D View)</h5>
              <p>🔴 Red lines = Water edges (left/right bank)</p>
              <p>🟡 Yellow line = Route centerline</p>
            </div>
          )}
          
          <div className="debug-section">
            <h5>Route Info</h5>
            <table className="debug-table">
              <tbody>
                <tr><td>Route:</td><td>{selectedRoute?.name ?? 'None'}</td></tr>
                <tr><td>Distance (km):</td><td>{selectedRoute?.distance ?? 'N/A'}</td></tr>
                <tr><td>Progress (%):</td><td>{pm5Data && selectedRoute ? ((pm5Data.distance / 1000) / selectedRoute.distance * 100).toFixed(1) : '0.0'}</td></tr>
              </tbody>
            </table>
          </div>
          
          <div className="debug-section">
            <h5>App State</h5>
            <table className="debug-table">
              <tbody>
                <tr><td>Current View:</td><td>{currentView}</td></tr>
                <tr><td>Workout Active:</td><td>{isWorkoutActive ? 'Yes' : 'No'}</td></tr>
                <tr><td>HR Samples:</td><td>{heartRateSamples.length}</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
