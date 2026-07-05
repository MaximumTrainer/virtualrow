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
import { routeEnrichmentService } from './services/routeEnrichmentService';
import { useAuth } from './context/AuthContext';
import { formatPace } from './utils/formatters';
import { buildSessionFITPayload, triggerBlobDownload } from './utils/exporters';
import type { WaterRoute, PM5Data, WorkoutSession, HeartRateSample } from './types/index';
import type { RouteEnrichmentData } from './services/routeEnrichmentService';
import './App.css';

// Session state type for workout controls
type SessionState = 'idle' | 'active' | 'paused';

/** Extract the rownative.icu status value from route tags (e.g. "status:provisional" → "provisional"). */
function extractRouteStatus(tags: string[] | undefined): string | undefined {
  return tags?.find((t) => t.startsWith('status:'))?.replace('status:', '');
}

function App() {
  const { isAuthenticated } = useAuth();
  const [currentView, setCurrentView] = useState<'routes' | 'workout' | 'history'>('routes');
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
  // Session state for the overlay UI
  const [sessionState, setSessionState] = useState<SessionState>('idle');
  // Guest mode — activated by ?guest=true URL param or Quick Start button
  const [isGuestMode, setIsGuestMode] = useState(false);
  // Holds a completed guest session until the summary modal is dismissed
  const [guestCompletedSession, setGuestCompletedSession] = useState<WorkoutSession | null>(null);
  // Route description panel state (collapsed/expanded)
  const [isRouteDescriptionExpanded, setIsRouteDescriptionExpanded] = useState(true);
  const [routeEnrichments, setRouteEnrichments] = useState<Record<string, RouteEnrichmentData>>({});
  const [routeEnrichmentLoading, setRouteEnrichmentLoading] = useState<Record<string, boolean>>({});
  // Completed (non-guest) workout sessions for the History view
  const [workoutHistory, setWorkoutHistory] = useState<WorkoutSession[]>([]);
  // Route import panel state
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [importRouteName, setImportRouteName] = useState('');

  // Activate guest mode if the URL contains ?guest=true
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      if (params.get('guest') === 'true') {
        setIsGuestMode(true);
      }
    }
  }, []);

  // When guest mode is activated (URL param or button) ensure Willowbrook is selected
  useEffect(() => {
    if (isGuestMode && routes.length > 0) {
      const wb = routes.find(r => r.id === '1');
      if (wb) setSelectedRoute(wb);
    }
  }, [isGuestMode, routes]);

  // Auto-start/stop the HR simulator when guest mode toggles
  useEffect(() => {
    if (isGuestMode) {
      heartRateSimulator.start(130);
    } else {
      heartRateSimulator.stop();
    }
    return () => {
      heartRateSimulator.stop();
    };
  }, [isGuestMode]);

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
    const onEnd = (e: Event) => {
      setIsWorkoutActive(false);
      setCurrentSession(null);
      setCurrentView('routes');
      if (e instanceof CustomEvent && e.detail) {
        const completed = e.detail as WorkoutSession;
        if (!completed.isGuest) {
          setWorkoutHistory((prev) => {
            if (prev.some((s) => s.id === completed.id)) return prev;
            return [...prev, completed];
          });
        }
      }
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

  // The Willowbrook River route (id '1') is the default guest route
  const willowbrookRoute = useMemo(() => routes.find(r => r.id === '1') ?? null, [routes]);
  const selectedRouteEnrichment = selectedRoute ? routeEnrichments[selectedRoute.id] ?? null : null;
  const selectedRouteEnrichmentLoading = selectedRoute ? !!routeEnrichmentLoading[selectedRoute.id] : false;

  const handleQuickStart = useCallback(() => {
    setIsGuestMode(true);
    if (willowbrookRoute) setSelectedRoute(willowbrookRoute);
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.set('guest', 'true');
      window.history.replaceState({}, '', url.toString());
    }
  }, [willowbrookRoute]);

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
        isGuestMode,
      );
      setCurrentSession(session);
      setIsWorkoutActive(true);
      setSessionState('active');
      setCurrentView('workout');
    } finally {
      isStartingSessionRef.current = false;
    }
  };

  const handleEndWorkout = useCallback(() => {
    const completed = workoutService.endSession();
    setIsWorkoutActive(false);
    setCurrentSession(null);
    setSessionState('idle');

    if (isGuestMode && completed) {
      // Show summary modal; do NOT push to workoutHistory (guest sessions are excluded)
      setGuestCompletedSession(completed);
    } else {
      setCurrentView('routes');
    }
  }, [isGuestMode]);

  const handleGuestRowAgain = useCallback(() => {
    setGuestCompletedSession(null);
    setCurrentView('routes');
  }, []);

  const handleGuestExit = useCallback(() => {
    setGuestCompletedSession(null);
    setIsGuestMode(false);
    setCurrentView('routes');
    // Remove ?guest param from URL without reload
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.delete('guest');
      window.history.replaceState({}, '', url.toString());
    }
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

  const handleExportFIT = useCallback((session: WorkoutSession) => {
    const payload = buildSessionFITPayload(session);
    const filename = `virtualrow-${session.id}.fit.json`;
    triggerBlobDownload(JSON.stringify(payload, null, 2), 'application/json', filename);
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
  }, []);

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
        />
      )}

      <header className="app-header">
        <div className="header-content">
          <h1 className="app-title">VirtualRow</h1>
          <p className="app-subtitle">Willowbrook demo plus rownative.icu route import for real-world rowing</p>
          <div className="header-auth">
            <AuthButton />
          </div>
        </div>
        {/* Show guest banner only when in guest mode and not authenticated */}
        {isGuestMode && !isAuthenticated && (
          <div className="guest-mode-banner">
            <span className="guest-badge-header">Guest Mode</span>
            <span className="guest-banner-text">Session data will not be saved.</span>
            <button className="btn-exit-guest" onClick={handleGuestExit} type="button">
              Exit Guest Mode
            </button>
          </div>
        )}
        {/* Sign-out from the auth dropdown also exits guest mode if active */}
      </header>

      <div className={`app-layout app-layout--${currentView}`}>
        <aside
          className={[
            'app-sidebar',
            isGuestMode ? 'app-sidebar--guest' : '',
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
            {!isGuestMode && (
              <button
                className={`nav-tab ${currentView === 'history' ? 'active' : ''}`}
                onClick={() => setCurrentView('history')}
              >
                <span className="tab-icon">📋</span> History
              </button>
            )}
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
          {/* Quick Start CTA — shown only when NOT in guest mode, on the routes view */}
          {currentView === 'routes' && !isGuestMode && (
            <div className="quick-start-banner">
              <div className="quick-start-content">
                <span className="quick-start-label">No account needed</span>
                <h3>Just want to row?</h3>
                <p>Start instantly on Willowbrook River — no sign-up, no data saved.</p>
              </div>
              <button className="btn btn-quick-start" onClick={handleQuickStart} type="button">
                ⚡ Quick Start
              </button>
            </div>
          )}

          {currentView === 'routes' && selectedRoute && (
            <div className="view-container view-container--routes">
              <div className="map-container">
                <RouteMap route={selectedRoute} />
              </div>
              <div className="route-details-panel">
                <button
                  className="btn-toggle-description btn-toggle-description--route-details"
                  onClick={() => setIsRouteDescriptionExpanded(!isRouteDescriptionExpanded)}
                  type="button"
                  aria-label={isRouteDescriptionExpanded ? "Collapse description" : "Expand description"}
                  aria-expanded={isRouteDescriptionExpanded}
                >
                  {isRouteDescriptionExpanded ? '▼' : '▶'} Description
                </button>

                {/* Route Info Overlay */}
                <div className="route-info-overlay">
                  <div className="route-info-header">
                    <h2>{selectedRoute.name}</h2>
                    <p className="route-location">📍 {selectedRoute.location}</p>
                  </div>

                  <div className="route-description-container">
                    {isRouteDescriptionExpanded && (
                      <p className="route-description">{selectedRoute.description}</p>
                    )}
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
                </div>

                {!isGuestMode && (
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

          {currentView === 'history' && (
            <div className="view-container history-view">
              <h2>Workout History</h2>
              {workoutHistory.length === 0 ? (
                <p className="empty-message">No workouts recorded yet.</p>
              ) : (
                <div className="history-list">
                  {[...workoutHistory].reverse().map((session) => (
                    <div key={session.id} className="history-item">
                      <div className="history-header">
                        <h3>{session.routeName}</h3>
                        <span className="date">
                          {new Date(session.startTime).toLocaleDateString()}
                        </span>
                      </div>
                      <div className="history-stats">
                        <span>{(session.distance / 1000).toFixed(2)} km</span>
                        <span>•</span>
                        <span>{Math.floor(session.duration / 60)}:{String(session.duration % 60).padStart(2, '0')}</span>
                        {session.averagePace > 0 && (
                          <>
                            <span>•</span>
                            <span>{formatPace(session.averagePace)}/500m</span>
                          </>
                        )}
                      </div>
                      <div className="history-actions">
                        <button
                          type="button"
                          className="btn-export"
                          onClick={() => handleExportFIT(session)}
                        >
                          FIT
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
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
                      performanceMode={window.__PLAYWRIGHT_TESTING ? 'low' : 'auto'}
                      debugMode={debugMode}
                    />
                  </Suspense>

                  <button
                    className="btn-toggle-description btn-toggle-description--activity"
                    onClick={() => setIsRouteDescriptionExpanded(!isRouteDescriptionExpanded)}
                    type="button"
                    aria-label={isRouteDescriptionExpanded ? "Collapse route info" : "Expand route info"}
                    aria-expanded={isRouteDescriptionExpanded}
                  >
                    {isRouteDescriptionExpanded ? '▼' : '▶'}
                  </button>

                  {isRouteDescriptionExpanded && (
                    <div className="activity-route-summary">
                      <h2>{selectedRoute?.name}</h2>
                      <p>{selectedRoute?.location}</p>
                      {selectedRoute && (
                        <p className="route-description route-description--activity">{selectedRoute.description}</p>
                      )}
                    </div>
                  )}

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
