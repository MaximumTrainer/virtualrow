import { useState, useEffect, useCallback } from 'react';
import { RouteMap } from './components/RouteMap';
import { BluetoothDevice } from './components/BluetoothDevice';
import { PM5Simulator } from './components/PM5Simulator';
import { routeService } from './services/routeService';
import { workoutService } from './services/workoutService';
import { workoutGeneratorService } from './services/workoutGeneratorService';
import HeartRateMonitor from './components/HeartRateMonitor';
import Rower3D from './components/Rower3D';
import { WorkoutGenerator } from './components/WorkoutGenerator';
import { WorkoutProgressDisplay } from './components/WorkoutProgressDisplay';
import { HeartRateZonesChart } from './components/HeartRateZonesChart';
import { PerformanceChart } from './components/PerformanceChart';
import type { WaterRoute, PM5Data, WorkoutSession, HeartRateSample, StructuredWorkout, WorkoutProgress } from './types/index';
import './App.css';

// Performance data point interface
interface PerformanceDataPoint {
  time: number;
  value: number;
}

function App() {
  const [currentView, setCurrentView] = useState<'routes' | 'workouts' | 'workout' | 'history'>('routes');
  const [routes, setRoutes] = useState<WaterRoute[]>([]);
  const [selectedRoute, setSelectedRoute] = useState<WaterRoute | null>(null);
  const [isWorkoutActive, setIsWorkoutActive] = useState(false);
  const [currentSession, setCurrentSession] = useState<WorkoutSession | null>(null);
  const [pm5Connected, setPM5Connected] = useState(false);
  const [pm5Data, setPM5Data] = useState<PM5Data | null>(null);
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
    if (!selectedRoute || !pm5Connected) {
      alert('Please connect PM5 device and select a route');
      return;
    }

    const session = workoutService.startSession(
      selectedRoute.id, 
      selectedRoute.name,
      selectedWorkout?.id
    );
    setCurrentSession(session);
    setIsWorkoutActive(true);
    
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
    workoutGeneratorService.endWorkout();
    setCurrentView('history');
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
    }
  }, [isWorkoutActive, currentSession, selectedWorkout]);

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

  // Calculate personal best for a route
  const getPersonalBest = useCallback((routeId: string) => {
    const sessionsByRoute = workoutHistory.filter(s => s.routeId === routeId && s.averagePace > 0);
    if (sessionsByRoute.length === 0) return null;
    return sessionsByRoute.reduce((best, session) => 
      session.averagePace < best.averagePace ? session : best
    , sessionsByRoute[0]);
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
        <aside className="app-sidebar">
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
              className={`nav-tab ${currentView === 'workout' ? 'active' : ''}`}
              onClick={() => setCurrentView('workout')}
            >
              <span className="tab-icon">⏱️</span> Workout
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
            <PM5Simulator
              onConnected={handlePM5Connected}
              onDisconnected={handlePM5Disconnected}
              onDataReceived={handlePM5Data}
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
                <RouteMap route={selectedRoute} onRouteSelected={handleRouteSelect} />
              </div>
              <div className="route-details-panel">
                <h2>{selectedRoute.name}</h2>
                <p className="route-location">📍 {selectedRoute.location}</p>
                <p className="route-description">{selectedRoute.description}</p>
                
                <div className="route-meta">
                  <div className="meta-item">
                    <span className="meta-label">Distance:</span>
                    <span>{selectedRoute.distance} km</span>
                  </div>
                  <div className="meta-item">
                    <span className="meta-label">Estimated Time:</span>
                    <span>{selectedRoute.estimatedTime} minutes</span>
                  </div>
                  <div className="meta-item">
                    <span className="meta-label">Difficulty:</span>
                    <span className={`badge badge-${selectedRoute.difficulty}`}>
                      {selectedRoute.difficulty}
                    </span>
                  </div>
                  {getPersonalBest(selectedRoute.id) && (
                    <div className="meta-item pb-highlight">
                      <span className="meta-label">🏆 Personal Best:</span>
                      <span>{getPersonalBest(selectedRoute.id)?.averagePace}s/500m</span>
                    </div>
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
                    <h4>Selected Workout</h4>
                    <p>{selectedWorkout.name}</p>
                    <button className="btn-clear-workout" onClick={handleClearWorkout}>
                      ✕ Clear Selection
                    </button>
                  </div>
                )}

                <button
                  className="btn btn-start-workout"
                  onClick={handleStartWorkout}
                  disabled={!pm5Connected}
                >
                  {pm5Connected ? '▶ Start Workout' : '⚠ Connect PM5 First'}
                </button>

                {/* Route Filters */}
                <div className="route-filters">
                  <h3>Filter Routes</h3>
                  <div className="filter-group">
                    <label>Difficulty:</label>
                    <select
                      value={difficultyFilter}
                      onChange={(e) => setDifficultyFilter(e.target.value as 'all' | 'easy' | 'moderate' | 'hard')}
                    >
                      <option value="all">All</option>
                      <option value="easy">Easy</option>
                      <option value="moderate">Moderate</option>
                      <option value="hard">Hard</option>
                    </select>
                  </div>
                  <div className="filter-group">
                    <label>Distance (km):</label>
                    <div className="distance-inputs">
                      <input
                        type="number"
                        min="0"
                        value={distanceMin}
                        onChange={(e) => setDistanceMin(Number(e.target.value))}
                        placeholder="Min"
                      />
                      <span>-</span>
                      <input
                        type="number"
                        min="0"
                        value={distanceMax}
                        onChange={(e) => setDistanceMax(Number(e.target.value))}
                        placeholder="Max"
                      />
                    </div>
                  </div>
                  <span className="filter-count">{filteredRoutes.length} routes</span>
                </div>

                <div className="routes-list">
                  <h3>Other Routes</h3>
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
                  isPlaying={isWorkoutActive} 
                  cadence={pm5Data?.cadence} 
                  performanceMode={(window as any).__PLAYWRIGHT_TESTING ? 'low' : 'auto'}
                  intensityFactor={selectedWorkout ? workoutGeneratorService.getSpeedAdjustmentFactor() : undefined}
                />
                
                {/* Workout Progress Display Overlay (top-left) */}
                {selectedWorkout && workoutProgress && (
                  <div className="workout-progress-overlay">
                    <WorkoutProgressDisplay
                      progress={workoutProgress}
                      allSegments={workoutGeneratorService.getCurrentWorkout()?.segments || []}
                    />
                  </div>
                )}
                
                {/* Performance Chart Toggle Button */}
                <button
                  className="btn-toggle-chart"
                  onClick={() => setShowPerformanceChart(!showPerformanceChart)}
                  title={showPerformanceChart ? 'Hide Performance Chart' : 'Show Performance Chart'}
                >
                  📈
                </button>
                
                {/* Performance Chart Overlay (bottom-left, above heart rate) */}
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
                
                {/* Bottom left: Heart rate */}
                <div className="overlay-bottom-left">
                  <div className="overlay-metric">
                    <span className="overlay-label">Heart rate</span>
                    {heartRateSamples.length > 0 && (
                      <span className="overlay-value-large">{heartRateSamples[heartRateSamples.length - 1].bpm}</span>
                    )}
                  </div>
                </div>

                {/* Bottom center: Time / metrics */}
                <div className="overlay-bottom-center">
                  {pm5Data && (
                    <>
                      <div className="overlay-metric-inline">
                        <span className="overlay-label">time:</span>
                        <span className="overlay-value">{formatTime(pm5Data.elapsedTime)}</span>
                      </div>
                      <div className="overlay-metric-inline">
                        <span className="overlay-label">pace:</span>
                        <span className="overlay-value">{pm5Data.pace ? (pm5Data.pace / 100).toFixed(1) : '--'}</span>
                      </div>
                      <div className="overlay-metric-inline">
                        <span className="overlay-label">distance:</span>
                        <span className="overlay-value">{(pm5Data.distance / 1000).toFixed(2)} km</span>
                      </div>
                    </>
                  )}
                </div>

                {/* Top right: End workout button and route map */}
                <div className="overlay-top-right-panel">
                  <button className="btn-overlay-end" onClick={handleEndWorkout}>
                    ⏹ End Workout
                  </button>
                  <div className="overlay-mini-map">
                    <RouteMap 
                      route={selectedRoute!} 
                      onRouteSelected={handleRouteSelect} 
                      highlightMode={true}
                      progressPercent={pm5Data && selectedRoute ? Math.min(100, (pm5Data.distance / 1000) / selectedRoute.distance * 100) : 0}
                    />
                  </div>
                </div>
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
