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
// Rower3D pulls in three, @react-three/{fiber,drei,postprocessing,rapier} (~hundreds of kB).
// Code-split it so the routes view doesn't pay the cost — the chunk only
// loads when the user actually starts a workout (currentView === 'workout').
const Rower3D = lazy(() => import('./components/Rower3D'));
import { RouteThumbnail } from './components/RouteThumbnail';
import { GuestSessionSummary } from './components/GuestSessionSummary';
import { AuthButton } from './components/AuthButton';
import { heartRateSimulator } from './services/heartRateSimulatorService';
import { pm5Simulator } from './services/pm5SimulatorService';
import { routeEnrichmentService } from './services/routeEnrichmentService';
import { useAuth } from './context/AuthContext';
import { useRownativeDeepLink } from './hooks/useRownativeDeepLink';
import { OUTLINE_ONLY_TAG } from './services/routeService';
import { resolvePerformanceMode } from './components/rower3d/constants';
import { formatPace } from './utils/formatters';
import type { WaterRoute, PM5Data, WorkoutSession, HeartRateSample } from './types/index';
import type { RouteEnrichmentData } from './services/routeEnrichmentService';
import './App.css';

// Session state type for workout controls
type SessionState = 'idle' | 'active' | 'paused';

/** Extract the rownative.icu status value from route tags (e.g. "status:provisional" → "provisional"). */
function extractRouteStatus(tags: string[] | undefined): string | undefined {
  return tags?.find((t) => t.startsWith('status:'))?.replace('status:', '');
}

/** rownative courses built from gate centroids are a coarse outline, not a surveyed path. */
function isOutlineOnly(tags: string[] | undefined): boolean {
  return !!tags?.includes(OUTLINE_ONLY_TAG);
}

function App() {
  const { isAuthenticated, isLoading, login } = useAuth();
  // In Playwright e2e tests, window.__PLAYWRIGHT_TESTING is set to true by mock-bluetooth.js.
  // Guard all unauthenticated-guest behaviours on this flag so tests can exercise the full UI.
  const isGuestSession = !isAuthenticated && !window.__PLAYWRIGHT_TESTING;
  const showAuthFeatures = isAuthenticated || !!window.__PLAYWRIGHT_TESTING;
  const [currentView, setCurrentView] = useState<'routes' | 'workout'>('routes');
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
  const activityTimerRef = useRef<number | null>(null);
  // Re-entrancy guards — prevent recursive session start or HR update loops
  const isStartingSessionRef = useRef(false);
  const isProcessingHrUpdateRef = useRef(false);
  // RAF-based throttle for PM5/HR state updates — avoids stack overflow when
  // Playwright CDP adds extra frames to the WS→characteristic notification path.
  const pm5DataPendingRef = useRef<PM5Data | null>(null);
  const pm5RafScheduledRef = useRef(false);
  // Debug mode state
  const [debugMode, setDebugMode] = useState(false);
  // Demo mode: a visitor with no hardware is rowing on simulated device data.
  const [isDemoMode, setIsDemoMode] = useState(false);
  // Session state for the overlay UI
  const [sessionState, setSessionState] = useState<SessionState>('idle');
  // Holds a completed unauthenticated session until the summary modal is dismissed
  const [guestCompletedSession, setGuestCompletedSession] = useState<WorkoutSession | null>(null);
  // Demo mode is cleared when the session ends, so remember it for the summary.
  const [completedSessionWasDemo, setCompletedSessionWasDemo] = useState(false);
  const [routeEnrichments, setRouteEnrichments] = useState<Record<string, RouteEnrichmentData>>({});
  const [routeEnrichmentLoading, setRouteEnrichmentLoading] = useState<Record<string, boolean>>({});
  // Route import panel state
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [importRouteName, setImportRouteName] = useState('');

  // Pre-select Willowbrook River for unauthenticated users.
  // Guarded to fire only once: this effect depends on `routes`, so without the
  // guard every route import re-ran it and snapped the selection back to
  // Willowbrook, discarding the route the user had just loaded.
  const hasPreselectedRef = useRef(false);
  useEffect(() => {
    if (hasPreselectedRef.current) return;
    if (!isAuthenticated && routes.length > 0) {
      const wb = routes.find(r => r.id === '1');
      if (wb) {
        setSelectedRoute(wb);
        hasPreselectedRef.current = true;
      }
    }
  }, [isAuthenticated, routes]);

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
    const allRoutes = routeService.getAllRoutes();
    setRoutes(allRoutes);
    if (allRoutes.length > 0) {
      setSelectedRoute(allRoutes[0]);
    }
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
  }, [selectedRoute]);

  const activeRowerLabel = useMemo(() => (
    activeRowerType === 'pm5' ? 'PM5' : 'FTMS'
  ), [activeRowerType]);
  const selectedRowerConnected = useMemo(() => (
    activeRowerType === 'pm5' ? pm5Connected : ftmsConnected
  ), [activeRowerType, ftmsConnected, pm5Connected]);

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
  }, []);

  const selectedRouteEnrichment = selectedRoute ? routeEnrichments[selectedRoute.id] ?? null : null;
  const selectedRouteEnrichmentLoading = selectedRoute ? !!routeEnrichmentLoading[selectedRoute.id] : false;

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
      );
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
   * Aimed at a visitor with no rowing machine: one control connects nothing by
   * hand, starts the rower and heart-rate simulators, and drops straight into
   * the session so the engine can be judged without buying hardware.
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
    const completed = workoutService.endSession();
    setIsWorkoutActive(false);
    setCurrentSession(null);
    setSessionState('idle');
    setCompletedSessionWasDemo(isDemoMode);
    if (isDemoMode) stopDemoDevices();

    if (isGuestSession && completed) {
      // Show summary modal for unauthenticated sessions
      setGuestCompletedSession(completed);
    } else {
      setCurrentView('routes');
    }
  }, [isGuestSession, isDemoMode, stopDemoDevices]);

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

          // Auto-end when distance reaches route length (skip in Playwright harness).
          if (selectedRoute && typeof window !== 'undefined' && !window.__PLAYWRIGHT_TESTING) {
            const routeDistanceMeters = selectedRoute.distance * 1000;
            const completionThreshold = routeDistanceMeters * 0.995;
            if (latest.distance >= completionThreshold && routeDistanceMeters > 0) {
              handleEndWorkout();
            }
          }
        }
      });
    }
  }, [isWorkoutActive, selectedRoute, handleEndWorkout]);

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

  const handlePM5Connected = useCallback(() => {
    setPM5Connected(true);
  }, []);

  const handlePM5Disconnected = useCallback(() => {
    setPM5Connected(false);
  }, []);

  const handleFtmsConnected = useCallback(() => {
    setFtmsConnected(true);
  }, []);

  const handleFtmsDisconnected = useCallback(() => {
    setFtmsConnected(false);
  }, []);

  // FTMS data arrives in the same PM5Data shape; merge into shared rower data state
  const handleFtmsData = useCallback((data: PM5Data) => {
    // Re-use the PM5 data pipeline so all workout tracking works regardless of device type
    handlePM5Data(data);
  }, [handlePM5Data]);

  const handleRouteImported = useCallback((route: WaterRoute) => {
    setRoutes(routeService.getAllRoutes());
    setSelectedRoute(route);
    setCurrentView('routes');
  }, []);

  // Deep link: if the app was opened with ?rownativeCourseId=<id>, load that
  // course and select it. Held until auth resolves so a shared link survives a
  // sign-in round trip.
  const { status: handoffStatus, dismiss: dismissHandoff } = useRownativeDeepLink({
    onRouteLoaded: handleRouteImported,
    isReady: !isLoading,
  });

  const handleGeoJSONFileImport = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      try {
        const parsed = JSON.parse(text);
        const nameFromFile =
          importRouteName.trim() ||
          (parsed?.properties?.name as string | undefined) ||
          file.name.replace(/\.[^.]+$/, '');
        const imported = routeService.importRouteFromGeoJSON(text, {
          name: nameFromFile,
          difficulty: 'moderate',
          location: (parsed?.properties?.country as string | undefined) ?? 'Imported',
          tags: ['imported', 'geojson'],
        });
        if (imported) {
          handleRouteImported(imported);
          setIsImportOpen(false);
          setImportRouteName('');
          // Reset the file input
          e.target.value = '';
        }
      } catch {
        // Ignore parse errors — user will see no route appear
      }
    };
    reader.readAsText(file);
  }, [importRouteName, handleRouteImported]);
  const latestHeartRate = useMemo(() => (
    heartRateSamples.length > 0
      ? heartRateSamples[heartRateSamples.length - 1].bpm
      : (pm5Data?.heartRate ?? null)
  ), [heartRateSamples, pm5Data]);
  const averageHeartRate = useMemo(() => {
    if (!currentSession?.heartRateSamples || currentSession.heartRateSamples.length === 0) {
      return null;
    }

    return Math.round(
      currentSession.heartRateSamples.reduce((sum, sample) => sum + sample.bpm, 0)
      / currentSession.heartRateSamples.length
    );
  }, [currentSession]);
  const maxHeartRate = useMemo(() => {
    if (!currentSession?.heartRateSamples || currentSession.heartRateSamples.length === 0) {
      return null;
    }

    return currentSession.heartRateSamples.reduce(
      (max, sample) => Math.max(max, sample.bpm),
      currentSession.heartRateSamples[0].bpm
    );
  }, [currentSession]);
  const workoutElapsedTimeMs = useMemo(() => (
    pm5Data?.elapsedTime ? pm5Data.elapsedTime * 1000 : activityElapsedMs
  ), [activityElapsedMs, pm5Data]);
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

      <header className="app-header">
        <div className="header-content">
          <h1 className="app-title">VirtualRow</h1>
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
          <nav className="nav-tabs">
            <button
              className={`nav-tab ${currentView === 'routes' ? 'active' : ''}`}
              onClick={() => setCurrentView('routes')}
            >
              <span className="tab-icon">🗺️</span> Routes
            </button>
          </nav>

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
                {activeRowerType === 'pm5' ? (
                  <BluetoothDevice
                    onConnected={handlePM5Connected}
                    onDisconnected={handlePM5Disconnected}
                    onDataReceived={handlePM5Data}
                  />
                ) : (
                  <FTMSDevice
                    onConnected={handleFtmsConnected}
                    onDisconnected={handleFtmsDisconnected}
                    onDataReceived={handleFtmsData}
                  />
                )}
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
                      ? `Loading rownative course ${handoffStatus.courseId}…`
                      : handoffStatus.message}
                    {handoffStatus.kind === 'error' && (
                      <button type="button" className="rownative-handoff-dismiss" onClick={dismissHandoff}>
                        Dismiss
                      </button>
                    )}
                  </div>
                )}

                {/* Route Info Overlay */}
                <div className="route-info-overlay">
                  <div className="route-info-header">
                    <h2>{selectedRoute.name}</h2>
                    <p className="route-location">📍 {selectedRoute.location}</p>
                  </div>

                  <div className="route-meta-compact">
                    <span className="meta-badge">
                      📏 {selectedRoute.distance} km
                    </span>
                    <span className="meta-badge">
                      ⏱️ {selectedRoute.estimatedTime} min
                    </span>
                    <span className={`meta-badge badge-${selectedRoute.difficulty}`}>
                      {selectedRoute.difficulty}
                    </span>
                    {isOutlineOnly(selectedRoute.tags) && (
                      <span className="meta-badge meta-badge--outline" title="This course is defined by start/finish gates only, so the path between them is approximate.">
                        outline only
                      </span>
                    )}
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

                  {!selectedRowerConnected && (
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
                  )}
                </div>

                {showAuthFeatures && (
                  <div className="routes-list">
                    <div className="routes-list-header">
                      <h3>Routes</h3>
                      <button
                        type="button"
                        className="btn-import-route"
                        onClick={() => setIsImportOpen((o) => !o)}
                        aria-expanded={isImportOpen}
                      >
                        Import Route
                      </button>
                      <RownativeRouteImport
                        onRouteImported={handleRouteImported}
                      />
                      {isImportOpen && (
                        <div className="route-import">
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
                            onChange={handleGeoJSONFileImport}
                          />
                        </div>
                      )}
                      <div className="route-filters">
                        <div className="filter-group">
                          {(['all', 'easy', 'moderate', 'hard'] as const).map((d) => (
                            <button
                              key={d}
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
                       return (
                         <div
                           key={route.id}
                           className={`route-item ${selectedRoute.id === route.id ? 'active' : ''}`}
                           onClick={() => handleRouteSelect(route)}
                         >
                           <div className="route-item-header">
                             <h4>{route.name}</h4>
                             <div className="route-item-badges">
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
                               {isOutlineOnly(route.tags) && (
                                 <span className="badge badge-outline">Outline</span>
                               )}
                             </div>
                           </div>
                           <p className="route-item-location">{route.location}</p>
                           <div className="route-item-meta">
                             <span>{route.distance} km</span>
                             <span>•</span>
                             <span>{route.estimatedTime} min</span>
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
                         </div>
                       );
                     })}
                  </div>
                )}
              </div>
            </div>
          )}

          {currentView === 'workout' && isWorkoutActive && currentSession && (
            <div className="view-container activity-view">
              <div className="activity-screen">
                <div className="activity-route-stage">
                  <Suspense
                    fallback={
                      <div
                        className="rower3d-fallback-marker"
                        data-loaded="loading"
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          height: '100%',
                          color: '#888',
                          fontSize: '13px',
                        }}
                      >
                        Loading 3D view…
                      </div>
                    }
                  >
                    <Rower3D
                      route={selectedRoute!}
                      enrichment={selectedRouteEnrichment}
                      paceSPer500={pm5Data?.pace ? (pm5Data.pace/100) : undefined}
                      distanceMeters={pm5Data?.distance}
                      isPlaying={isWorkoutActive && sessionState === 'active'}
                      cadence={pm5Data?.cadence}
                      performanceMode={resolvePerformanceMode()}
                      debugMode={debugMode}
                    />
                  </Suspense>

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
                </div>

                <div className="activity-stats-panel">
                  <div className="activity-stats-grid">
                    <div className="activity-stat-card">
                      <span className="activity-stat-label">Time</span>
                      <span className="activity-stat-value">{formatTime(workoutElapsedTimeMs)}</span>
                    </div>
                    <div className="activity-stat-card">
                      <span className="activity-stat-label">Meters</span>
                      <span className="activity-stat-value">{Math.round(currentSession.distance)} m</span>
                    </div>
                    <div className="activity-stat-card">
                      <span className="activity-stat-label">Split (/500m)</span>
                      <span className="activity-stat-value">{formatPace(pm5Data?.pace ? pm5Data.pace / 100 : null)}</span>
                    </div>
                    <div className="activity-stat-card">
                      <span className="activity-stat-label">SPM</span>
                      <span className="activity-stat-value">{pm5Data?.cadence ?? '--'} spm</span>
                    </div>
                    <div className="activity-stat-card">
                      <span className="activity-stat-label">Power</span>
                      <span className="activity-stat-value">{pm5Data?.power ?? '--'} W</span>
                    </div>
                    <div className="activity-stat-card">
                      <span className="activity-stat-label">Heart Rate</span>
                      <span className="activity-stat-value">{latestHeartRate ?? '--'} bpm</span>
                    </div>
                    <div className="activity-stat-card">
                      <span className="activity-stat-label">Avg HR</span>
                      <span className="activity-stat-value">{averageHeartRate ?? '--'} bpm</span>
                    </div>
                    <div className="activity-stat-card">
                      <span className="activity-stat-label">Max HR</span>
                      <span className="activity-stat-value">{maxHeartRate ?? '--'} bpm</span>
                    </div>
                  </div>

                  <div className="activity-controls">
                    <button
                      className="btn btn-activity-control"
                      onClick={sessionState === 'paused' ? handleResumeWorkout : handlePauseWorkout}
                      type="button"
                    >
                      {sessionState === 'paused' ? '▶ Resume' : '⏸ Pause'}
                    </button>
                    <button
                      className="btn btn-activity-control btn-activity-control--subtle"
                      onClick={handleResetWorkout}
                      type="button"
                    >
                      ↺ Reset
                    </button>
                    <button
                      className="btn btn-activity-control btn-activity-control--danger btn-end-workout"
                      onClick={handleEndWorkout}
                      type="button"
                    >
                      ⏹ End Workout
                    </button>
                  </div>
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
            <h5>PM5 Data (Live)</h5>
            <table className="debug-table">
              <tbody>
                <tr><td>Connected:</td><td>{pm5Connected ? '✅ Yes' : '❌ No'}</td></tr>
                <tr><td>Pace (raw):</td><td>{pm5Data?.pace ?? 'N/A'}</td></tr>
                <tr><td>Pace (s/500m):</td><td>{pm5Data?.pace ? (pm5Data.pace / 100).toFixed(2) : 'N/A'}</td></tr>
                <tr><td>Speed (m/s):</td><td>{pm5Data?.pace ? (500 / (pm5Data.pace / 100)).toFixed(2) : 'N/A'}</td></tr>
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

function formatTime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}:${String(minutes % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  }
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
}

export default App;
