import { useState, useEffect, useCallback, useRef } from 'react';
import { RouteMap } from './components/RouteMap';
import { BluetoothDevice } from './components/BluetoothDevice';
import { PM5Simulator } from './components/PM5Simulator';
import { RouteImport } from './components/RouteImport';
import { FTMSDevice } from './components/FTMSDevice';
import { routeService } from './services/routeService';
import { workoutService } from './services/workoutService';
import { workoutGeneratorService } from './services/workoutGeneratorService';
import HeartRateMonitor from './components/HeartRateMonitor';
import Rower3D from './components/Rower3D';
import { WorkoutGenerator } from './components/WorkoutGenerator';
import { WorkoutProgressDisplay } from './components/WorkoutProgressDisplay';
import { HeartRateZonesChart } from './components/HeartRateZonesChart';
import { PerformanceChart } from './components/PerformanceChart';
import { RowingOverlay } from './components/RowingOverlay';
import type { WaterRoute, PM5Data, WorkoutSession, HeartRateSample, StructuredWorkout, WorkoutProgress } from './types/index';
import './App.css';

// Performance data point interface
interface PerformanceDataPoint {
  time: number;
  value: number;
}

// Session state type for workout controls
type SessionState = 'idle' | 'active' | 'paused';

function App() {
  const [currentView, setCurrentView] = useState<'routes' | 'workouts' | 'workout' | 'history'>('routes');
  const [routes, setRoutes] = useState<WaterRoute[]>([]);
  const [selectedRoute, setSelectedRoute] = useState<WaterRoute | null>(null);
  const [isWorkoutActive, setIsWorkoutActive] = useState(false);
  const [currentSession, setCurrentSession] = useState<WorkoutSession | null>(null);
  const [pm5Connected, setPM5Connected] = useState(false);
  const [pm5Data, setPM5Data] = useState<PM5Data | null>(null);
  const [ftmsConnected, setFtmsConnected] = useState(false);
  const [workoutHistory, setWorkoutHistory] = useState<WorkoutSession[]>([]);
  const [heartRateSamples, setHeartRateSamples] = useState<HeartRateSample[]>([]);
  const [selectedWorkout, setSelectedWorkout] = useState<StructuredWorkout | null>(null);
  const [workoutProgress, setWorkoutProgress] = useState<WorkoutProgress | null>(null);
  // Filter state for routes
  const [difficultyFilter, setDifficultyFilter] = useState<'all' | 'easy' | 'moderate' | 'hard'>('all');
  const [distanceMin, setDistanceMin] = useState<number>(0);
  const [distanceMax, setDistanceMax] = useState<number>(100);
  // Real-time performance data
  const [paceHistory, setPaceHistory] = useState<PerformanceDataPoint[]>([]);
  const [heartRateHistory, setHeartRateHistory] = useState<PerformanceDataPoint[]>([]);
  const [showPerformanceChart, setShowPerformanceChart] = useState(false);
  // Local activity timer (ms elapsed since workout started)
  const [activityElapsedMs, setActivityElapsedMs] = useState(0);
  const activityTimerRef = useRef<number | null>(null);
  // Debug mode state
  const [debugMode, setDebugMode] = useState(false);
  // Session state for the overlay UI
  const [sessionState, setSessionState] = useState<SessionState>('idle');
  // Use new overlay mode (toggle for transition)
  const [useNewOverlay, setUseNewOverlay] = useState(true);

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
    
    setWorkoutHistory(workoutService.getAllSessions());
  }, []);

  // Listen to programmatic session events from the workoutService to update UI state
  useEffect(() => {
    const onStartup = (e: any) => {
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
      setCurrentView('history');
      setWorkoutHistory(workoutService.getAllSessions());
    };
    try {
      window.addEventListener('virtualrow:sessionStarted', onStartup as any);
      window.addEventListener('virtualrow:sessionEnded', onEnd as any);
    } catch (e) { /* ignore during SSR or when window not present */ }
    return () => {
      try {
        window.removeEventListener('virtualrow:sessionStarted', onStartup as any);
        window.removeEventListener('virtualrow:sessionEnded', onEnd as any);
      } catch (e) { /* ignore */ }
    };
  }, [routeService]);

  const handleRouteSelect = (route: WaterRoute) => {
    setSelectedRoute(route);
  };

  const handleStartWorkout = () => {
    const rowerConnected = pm5Connected || ftmsConnected;
    if (!selectedRoute || !rowerConnected) {
      alert('Please connect a rowing device (PM5 or FTMS) and select a route');
      return;
    }

    const session = workoutService.startSession(
      selectedRoute.id, 
      selectedRoute.name,
      selectedWorkout?.id
    );
    setCurrentSession(session);
    setIsWorkoutActive(true);
    setSessionState('active');
    
    // Start structured workout if selected
    if (selectedWorkout) {
      const progress = workoutGeneratorService.startWorkout(selectedWorkout.id);
      setWorkoutProgress(progress);
    }
    
    setCurrentView('workout');
  };

  const handleEndWorkout = () => {
    const completed = workoutService.endSession();
    if (completed) {
      setWorkoutHistory(workoutService.getAllSessions());
    }
    setIsWorkoutActive(false);
    setCurrentSession(null);
    setWorkoutProgress(null);
    setPaceHistory([]);
    setHeartRateHistory([]);
    setSessionState('idle');
    workoutGeneratorService.endWorkout();
    setCurrentView('history');
  };

  const handlePauseWorkout = () => {
    setSessionState('paused');
    // Note: Full pause logic would need to be added to workoutService
  };

  const handleResumeWorkout = () => {
    setSessionState('active');
    // Note: Full resume logic would need to be added to workoutService
  };

  const handleResetWorkout = () => {
    // Reset metrics but keep session
    setPaceHistory([]);
    setHeartRateHistory([]);
    setActivityElapsedMs(0);
    // Note: Full reset logic would need to clear workoutService data
  };

  const handleSelectWorkout = (workout: StructuredWorkout | null) => {
    setSelectedWorkout(workout);
  };

  const handleClearWorkout = () => {
    setSelectedWorkout(null);
  };

  // Get filtered routes based on current filter settings
  const getFilteredRoutes = useCallback(() => {
    let filtered = routes;
    if (difficultyFilter !== 'all') {
      filtered = filtered.filter(r => r.difficulty === difficultyFilter);
    }
    filtered = filtered.filter(r => r.distance >= distanceMin && r.distance <= distanceMax);
    return filtered;
  }, [routes, difficultyFilter, distanceMin, distanceMax]);

  const filteredRoutes = getFilteredRoutes();

  const handlePM5Data = useCallback((data: PM5Data) => {
    setPM5Data(data);
    if (isWorkoutActive && currentSession) {
      workoutService.updateSessionWithPM5Data(data);
      
      // Update structured workout progress if active
      if (selectedWorkout) {
        const progress = workoutGeneratorService.updateProgress(data);
        if (progress) {
          setWorkoutProgress(progress);
          workoutService.updateWorkoutProgress(progress);
        }
      }
      
      // Collect performance history for charts
      const elapsedTime = Math.floor(data.elapsedTime / 1000);
      if (data.pace) {
        setPaceHistory(prev => {
          const newPoint = { time: elapsedTime, value: data.pace! };
          // Only slice if we exceed the limit to avoid unnecessary array operations
          if (prev.length >= 300) {
            return [...prev.slice(-299), newPoint];
          }
          return [...prev, newPoint];
        });
      }
      if (data.heartRate) {
        setHeartRateHistory(prev => {
          const newPoint = { time: elapsedTime, value: data.heartRate! };
          // Only slice if we exceed the limit to avoid unnecessary array operations
          if (prev.length >= 300) {
            return [...prev.slice(-299), newPoint];
          }
          return [...prev, newPoint];
        });
      }
      
      // If PM5 gives HR, ensure samples state updates from session source
      if (data.heartRate) {
        const updated = workoutService.getCurrentSession();
        setHeartRateSamples(updated?.heartRateSamples ? [...updated.heartRateSamples] : []);
      }
      setCurrentSession({ ...currentSession });

      // If this workout is tied to a route, automatically end when distance reaches route length.
      // Skip this behavior under Playwright harness to keep E2E tests stable.
      if (selectedRoute && typeof window !== 'undefined' && !(window as any).__PLAYWRIGHT_TESTING) {
        const routeDistanceMeters = selectedRoute.distance * 1000; // route distance is stored in km
        const completionThreshold = routeDistanceMeters * 0.995; // small tolerance to avoid early cutoff
        if (data.distance >= completionThreshold && routeDistanceMeters > 0) {
          handleEndWorkout();
        }
      }
    }
  }, [isWorkoutActive, currentSession, selectedWorkout, selectedRoute, handleEndWorkout]);

  // Expose PM5 data on window for E2E tests to inspect cadence / pace
  useEffect(() => {
    try {
      // @ts-ignore
      (window as any).__PM5_DATA = pm5Data;
    } catch (e) { /* ignore during SSR */ }
  }, [pm5Data]);

  const handleHeartRateSample = useCallback((bpm: number) => {
    void bpm; // use value trivial to avoid unused parameter error
    if (isWorkoutActive) {
      const session = workoutService.getCurrentSession();
      setHeartRateSamples(session?.heartRateSamples ? [...session.heartRateSamples] : []);
      if (currentSession) setCurrentSession({ ...currentSession });
    }
  }, [isWorkoutActive, currentSession]);

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

  // Export session as GPX format
  const handleExportGPX = useCallback((session: WorkoutSession) => {
    const route = routeService.getRouteById(session.routeId);
    if (!route) {
      alert('Route data not available for this workout');
      return;
    }
    
    const gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="VirtualRow">
  <metadata>
    <name>${session.routeName}</name>
    <time>${new Date(session.startTime).toISOString()}</time>
  </metadata>
  <trk>
    <name>${session.routeName}</name>
    <trkseg>
${route.coordinates.map(c => `      <trkpt lat="${c.lat}" lon="${c.lng}"><ele>0</ele></trkpt>`).join('\n')}
    </trkseg>
  </trk>
</gpx>`;
    
    const blob = new Blob([gpx], { type: 'application/gpx+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `virtualrow-${session.id}.gpx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, []);

  // Export session as FIT format (simplified JSON structure for now)
  const handleExportFIT = useCallback((session: WorkoutSession) => {
    // Note: True FIT format is binary. This exports a JSON representation
    // that could be converted to FIT using external tools
    // Generate a numeric serial from session ID (use hash if not numeric)
    const serialNumber = /^\d+$/.test(session.id) 
      ? parseInt(session.id, 10) 
      : session.id.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    const fitData = {
      file_id: {
        type: 'activity',
        manufacturer: 'VirtualRow',
        product: 1,
        serial_number: serialNumber,
        time_created: new Date(session.startTime).toISOString()
      },
      activity: {
        timestamp: new Date(session.startTime).toISOString(),
        total_timer_time: session.duration,
        num_sessions: 1,
        type: 'manual'
      },
      session: {
        timestamp: new Date(session.startTime).toISOString(),
        start_time: new Date(session.startTime).toISOString(),
        total_elapsed_time: session.duration,
        total_timer_time: session.duration,
        total_distance: session.distance,
        total_calories: session.calories,
        avg_pace: session.averagePace,
        avg_heart_rate: session.heartRateAvg,
        max_heart_rate: session.heartRateMax,
        sport: 'rowing',
        sub_sport: 'indoor_rowing'
      },
      records: session.splits.map(split => ({
        timestamp: new Date(split.timestamp).toISOString(),
        distance: split.distance,
        pace: split.pace,
        power: split.power,
        heart_rate: split.heartRate
      }))
    };
    
    const blob = new Blob([JSON.stringify(fitData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `virtualrow-${session.id}.fit.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, []);

  // Calculate personal best for a route (only completed sessions count)
  const getPersonalBest = useCallback((routeId: string) => {
    const route = routeService.getRouteById(routeId);
    if (!route) return null;
    const routeDistanceMeters = route.distance * 1000; // route.distance is in km
    // Only sessions that completed the full course are eligible for PB
    const completedSessions = workoutHistory.filter(
      s => s.routeId === routeId && s.averagePace > 0 && s.distance >= routeDistanceMeters
    );
    if (completedSessions.length === 0) return null;
    return completedSessions.reduce((best, session) =>
      session.averagePace < best.averagePace ? session : best
    , completedSessions[0]);
  }, [workoutHistory]);

  const stats = workoutService.getStats();

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="header-content">
          <h1 className="app-title">🚣 VirtualRow</h1>
          <p className="app-subtitle">Virtual rowing on water routes around the world</p>
        </div>
      </header>

      <div className="app-layout">
        <aside
          className={
            `app-sidebar ${
              isWorkoutActive && currentView === 'workout' && !(window as any).__PLAYWRIGHT_TESTING
                ? 'app-sidebar--hidden'
                : ''
            }`
          }
        >
          <nav className="nav-tabs">
            <button
              className={`nav-tab ${currentView === 'routes' ? 'active' : ''}`}
              onClick={() => setCurrentView('routes')}
            >
              <span className="tab-icon">🗺️</span> Routes
            </button>
            <button
              className={`nav-tab ${currentView === 'workouts' ? 'active' : ''}`}
              onClick={() => setCurrentView('workouts')}
            >
              <span className="tab-icon">💪</span> Workouts
            </button>
            <button
              className={`nav-tab ${currentView === 'history' ? 'active' : ''}`}
              onClick={() => setCurrentView('history')}
            >
              <span className="tab-icon">📊</span> History
            </button>
          </nav>

          <div className="device-panel">
            <h3 className="panel-title">PM5 Device</h3>
            <BluetoothDevice
              onConnected={handlePM5Connected}
              onDisconnected={handlePM5Disconnected}
              onDataReceived={handlePM5Data}
            />
          </div>
          <div className="device-panel">
            <h3 className="panel-title">FTMS Device</h3>
            <FTMSDevice
              onConnected={handleFtmsConnected}
              onDisconnected={handleFtmsDisconnected}
              onDataReceived={handleFtmsData}
            />
          </div>
          <div className="device-panel">
            <HeartRateMonitor onSample={handleHeartRateSample} />
          </div>

          {isWorkoutActive && currentSession && (
            <div className="workout-stats-panel">
              <h3 className="panel-title">Current Workout</h3>
              <div className="stats-grid">
                <div className="stat-item">
                  <span className="stat-label">Distance</span>
                  <span className="stat-value">{(currentSession.distance / 1000).toFixed(2)}</span>
                  <span className="stat-unit">km</span>
                </div>
                <div className="stat-item">
                  <span className="stat-label">Time</span>
                  <span className="stat-value">{formatDuration(currentSession.duration)}</span>
                </div>
                {currentSession.heartRateSamples && currentSession.heartRateSamples.length > 0 && (
                  <div className="stat-item">
                    <span className="stat-label">Avg HR</span>
                    <span className="stat-value">{Math.round(currentSession.heartRateSamples.reduce((sum, s) => sum + s.bpm, 0) / currentSession.heartRateSamples.length)}</span>
                    <span className="stat-unit">bpm</span>
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="history-stats-panel">
            <h3 className="panel-title">Stats</h3>
            <div className="stats-compact">
              <div className="stat-compact">
                <span className="label">Workouts</span>
                <span className="value">{stats.totalWorkouts}</span>
              </div>
              <div className="stat-compact">
                <span className="label">Distance</span>
                <span className="value">{(stats.totalDistance / 1000).toFixed(1)} km</span>
              </div>
              <div className="stat-compact">
                <span className="label">Time</span>
                <span className="value">{formatDuration(stats.totalTime)}</span>
              </div>
            </div>
          </div>
        </aside>

        <main className="app-main">
          {currentView === 'routes' && selectedRoute && (
            <div className="view-container">
              <div className="map-container">
                <RouteMap route={selectedRoute} />
              </div>
              <div className="route-details-panel">

                {/* Route Info Overlay */}
                <div className="route-info-overlay">
                  <div className="route-info-header">
                    <h2>{selectedRoute.name}</h2>
                    <p className="route-location">📍 {selectedRoute.location}</p>
                  </div>
                  
                  <p className="route-description">{selectedRoute.description}</p>
                  
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
                    {getPersonalBest(selectedRoute.id) && (
                      <span className="meta-badge pb-badge">
                        🏆 PB: {getPersonalBest(selectedRoute.id)?.averagePace}s/500m
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

                  {selectedWorkout && (
                    <div className="selected-workout-info">
                      <span>🎯 {selectedWorkout.name}</span>
                      <button className="btn-clear-workout" onClick={handleClearWorkout}>
                        ✕
                      </button>
                    </div>
                  )}

                  <button
                    className="btn btn-start-workout"
                    onClick={handleStartWorkout}
                    disabled={!pm5Connected && !ftmsConnected}
                  >
                    {(pm5Connected || ftmsConnected) ? '▶ Start Workout' : '⚠ Connect Rower First'}
                  </button>
                </div>

                <div className="routes-list">
                  <div className="routes-list-header">
                    <h3>Routes</h3>
                    <RouteImport onRouteImported={handleRouteImported} />
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
                  {filteredRoutes.map((route) => (
                    <div
                      key={route.id}
                      className={`route-item ${selectedRoute.id === route.id ? 'active' : ''}`}
                      onClick={() => handleRouteSelect(route)}
                    >
                      <div className="route-item-header">
                        <h4>{route.name}</h4>
                        <span className={`badge badge-${route.difficulty}`}>
                          {route.difficulty}
                        </span>
                      </div>
                      <p className="route-item-location">{route.location}</p>
                      <div className="route-item-meta">
                        <span>{route.distance} km</span>
                        <span>•</span>
                        <span>{route.estimatedTime} min</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* New Workouts Tab View */}
          {currentView === 'workouts' && (
            <div className="view-container workouts-view">
              <WorkoutGenerator
                onSelectWorkout={handleSelectWorkout}
                selectedWorkout={selectedWorkout}
              />
            </div>
          )}

          {currentView === 'workout' && isWorkoutActive && currentSession && (
            <div className="view-container workout-view-fullscreen">
              {/* Fullscreen 3D scene with overlays */}
              <div className="fullscreen-3d-container">
                <Rower3D 
                  route={selectedRoute!} 
                  paceSPer500={pm5Data?.pace ? (pm5Data.pace/100) : undefined} 
                  distanceMeters={pm5Data?.distance} 
                  isPlaying={isWorkoutActive && sessionState === 'active'} 
                  cadence={pm5Data?.cadence} 
                  performanceMode={(window as any).__PLAYWRIGHT_TESTING ? 'low' : 'auto'}
                  intensityFactor={selectedWorkout ? workoutGeneratorService.getSpeedAdjustmentFactor() : undefined}
                  debugMode={debugMode}
                />
                
                {/* New Rowing Overlay UI */}
                {useNewOverlay ? (
                  <RowingOverlay
                    pm5Data={pm5Data}
                    heartRate={heartRateSamples.length > 0 ? heartRateSamples[heartRateSamples.length - 1].bpm : null}
                    elapsedTimeMs={pm5Data?.elapsedTime ? pm5Data.elapsedTime * 1000 : activityElapsedMs}
                    isPlaying={isWorkoutActive && sessionState === 'active'}
                    workoutProgress={workoutProgress}
                    onStart={handleStartWorkout}
                    onPause={handlePauseWorkout}
                    onResume={handleResumeWorkout}
                    onEnd={handleEndWorkout}
                    onReset={handleResetWorkout}
                    paceHistory={paceHistory}
                    powerHistory={paceHistory.map(p => ({ time: p.time, value: pm5Data?.power || 0 }))}
                  />
                ) : (
                  <>
                    {/* Legacy Overlay - Workout Progress Display Overlay (top-left) */}
                    {selectedWorkout && workoutProgress && (
                      <div className="workout-progress-overlay">
                        <WorkoutProgressDisplay
                          progress={workoutProgress}
                          allSegments={workoutGeneratorService.getCurrentWorkout()?.segments || []}
                        />
                      </div>
                    )}
                    
                    {/* Legacy Overlay - Performance Chart Toggle Button */}
                    <button
                      className="btn-toggle-chart"
                      onClick={() => setShowPerformanceChart(!showPerformanceChart)}
                      title={showPerformanceChart ? 'Hide Performance Chart' : 'Show Performance Chart'}
                    >
                      📈
                    </button>
                    
                    {/* Legacy Overlay - Performance Chart Overlay (bottom-left, above heart rate) */}
                    {showPerformanceChart && (paceHistory.length > 0 || heartRateHistory.length > 0) && (
                      <div className="performance-chart-overlay">
                        <PerformanceChart
                          paceData={paceHistory}
                          heartRateData={heartRateHistory}
                          showPace={true}
                          showHeartRate={true}
                          maxPoints={60}
                        />
                      </div>
                    )}
                    
                    {/* Legacy Overlay - Bottom left: Heart rate */}
                    <div className="overlay-bottom-left">
                      <div className="overlay-metric">
                        <span className="overlay-label">Heart rate</span>
                        {heartRateSamples.length > 0 && (
                          <span className="overlay-value-large">{heartRateSamples[heartRateSamples.length - 1].bpm}</span>
                        )}
                      </div>
                    </div>

                    {/* Legacy Overlay - Bottom center: Time / metrics */}
                    <div className="overlay-bottom-center">
                      <div className="overlay-metric-inline">
                        <span className="overlay-label">time:</span>
                        <span className="overlay-value">{formatTime(pm5Data?.elapsedTime ? pm5Data.elapsedTime * 1000 : activityElapsedMs)}</span>
                      </div>
                      <div className="overlay-metric-inline">
                        <span className="overlay-label">pace:</span>
                        <span className="overlay-value">{pm5Data?.pace ? (pm5Data.pace / 100).toFixed(1) : '--'}</span>
                      </div>
                      <div className="overlay-metric-inline">
                        <span className="overlay-label">distance:</span>
                        <span className="overlay-value">{pm5Data ? (pm5Data.distance / 1000).toFixed(2) : '0.00'} km</span>
                      </div>
                    </div>

                    {/* Legacy Overlay - Top right: End workout button and route map */}
                    <div className="overlay-top-right-panel">
                      <button className="btn-overlay-end" onClick={handleEndWorkout}>
                        ⏹ End Workout
                      </button>
                      <div className="overlay-mini-map">
                        <RouteMap 
                          route={selectedRoute!} 
                          highlightMode={true}
                          progressPercent={pm5Data && selectedRoute ? Math.min(100, (pm5Data.distance / 1000) / selectedRoute.distance * 100) : 0}
                        />
                      </div>
                    </div>
                  </>
                )}
                
                {/* Overlay toggle button */}
                <button
                  className="btn-toggle-overlay-mode"
                  onClick={() => setUseNewOverlay(!useNewOverlay)}
                  title={useNewOverlay ? 'Switch to Crisp Display' : 'Switch to Data Rich'}
                  style={{
                    position: 'absolute',
                    top: '10px',
                    left: '10px',
                    zIndex: 150,
                    padding: '6px 12px',
                    background: 'rgba(15, 23, 42, 0.8)',
                    border: '1px solid rgba(255,255,255,0.2)',
                    borderRadius: '8px',
                    color: '#fff',
                    fontSize: '11px',
                    cursor: 'pointer',
                  }}
                >
                  {useNewOverlay ? '🎨 Data Rich' : '📊 Crisp Display'}
                </button>
              </div>
            </div>
          )}

          {currentView === 'history' && (
            <div className="view-container history-view">
              <h2>Workout History</h2>
              
              {workoutHistory.length === 0 ? (
                <p className="empty-message">No workouts yet. Start a new workout to begin!</p>
              ) : (
                <div className="history-list">
                  {workoutHistory
                    .slice()
                    .reverse()
                    .map((session) => {
                      const pb = getPersonalBest(session.routeId);
                      const isPB = pb && pb.id === session.id;
                      return (
                        <div key={session.id} className={`history-item ${isPB ? 'pb-item' : ''}`}>
                          <div className="history-header">
                            <h3>
                              {session.routeName}
                              {isPB && <span className="pb-badge">🏆 PB</span>}
                            </h3>
                            <span className="date">
                              {new Date(session.startTime).toLocaleDateString()}
                            </span>
                          </div>
                          <div className="history-stats">
                            <div className="stat">
                              <span>{(session.distance / 1000).toFixed(2)} km</span>
                            </div>
                            <div className="stat">
                              <span>{formatDuration(session.duration)}</span>
                            </div>
                            <div className="stat">
                              <span>{session.averagePace}s/500m</span>
                            </div>
                            <div className="stat">
                              <span>{session.calories} kcal</span>
                            </div>
                          </div>
                          {session.workoutProgress && (
                            <div className="compliance-info">
                              <span className="compliance-label">Compliance:</span>
                              <span className={`compliance-value ${session.workoutProgress.isOnTarget ? 'on-target' : 'off-target'}`}>
                                {session.workoutProgress.isOnTarget ? '✓ On Target' : '⚠ Off Target'}
                              </span>
                            </div>
                          )}
                          <div className="history-actions">
                            <button
                              className="btn-export"
                              onClick={() => handleExportGPX(session)}
                              title="Export as GPX"
                            >
                              📍 GPX
                            </button>
                            <button
                              className="btn-export"
                              onClick={() => handleExportFIT(session)}
                              title="Export as FIT"
                            >
                              📊 FIT
                            </button>
                          </div>
                          {session.heartRateSamples && session.heartRateSamples.length > 0 && (
                            <div className="hr-zones-section">
                              <HeartRateZonesChart samples={session.heartRateSamples} />
                            </div>
                          )}
                        </div>
                      );
                    })}
                </div>
              )}
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

function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${secs}s`;
  }
  return `${secs}s`;
}

export default App;
