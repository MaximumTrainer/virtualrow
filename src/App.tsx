import { useState, useEffect, useCallback } from 'react';
import { RouteMap } from './components/RouteMap';
import { BluetoothDevice } from './components/BluetoothDevice';
import { routeService } from './services/routeService';
import { workoutService } from './services/workoutService';
import HeartRateMonitor from './components/HeartRateMonitor';
import HeartRateChart from './components/HeartRateChart';
import Rower3D from './components/Rower3D';
import MiniMetrics from './components/MiniMetrics';
import type { WaterRoute, PM5Data, WorkoutSession, HeartRateSample } from './types/index';
import './App.css';

function App() {
  const [currentView, setCurrentView] = useState<'routes' | 'workout' | 'history'>('routes');
  const [routes, setRoutes] = useState<WaterRoute[]>([]);
  const [selectedRoute, setSelectedRoute] = useState<WaterRoute | null>(null);
  const [isWorkoutActive, setIsWorkoutActive] = useState(false);
  const [currentSession, setCurrentSession] = useState<WorkoutSession | null>(null);
  const [pm5Connected, setPM5Connected] = useState(false);
  const [pm5Data, setPM5Data] = useState<PM5Data | null>(null);
  const [workoutHistory, setWorkoutHistory] = useState<WorkoutSession[]>([]);
  const [heartRateSamples, setHeartRateSamples] = useState<HeartRateSample[]>([]);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importName, setImportName] = useState('Imported Route');
  const [importDifficulty, setImportDifficulty] = useState<'easy' | 'moderate' | 'hard'>('moderate');
  const [importLocation, setImportLocation] = useState('Imported');
  const [importForce, setImportForce] = useState(false);
  const [importMessage, setImportMessage] = useState<string | null>(null);

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

    const session = workoutService.startSession(selectedRoute.id, selectedRoute.name);
    setCurrentSession(session);
    setIsWorkoutActive(true);
    setCurrentView('workout');
  };

  const handleEndWorkout = () => {
    const completed = workoutService.endSession();
    if (completed) {
      setWorkoutHistory(workoutService.getAllSessions());
    }
    setIsWorkoutActive(false);
    setCurrentSession(null);
    setCurrentView('history');
  };

  const handlePM5Data = useCallback((data: PM5Data) => {
    setPM5Data(data);
    if (isWorkoutActive && currentSession) {
      workoutService.updateSessionWithPM5Data(data);
      // If PM5 gives HR, ensure samples state updates from session source
      if (data.heartRate) {
        const updated = workoutService.getCurrentSession();
        setHeartRateSamples(updated?.heartRateSamples ? [...updated.heartRateSamples] : []);
      }
      setCurrentSession({ ...currentSession });
    }
  }, [isWorkoutActive, currentSession]);

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

  const handleFilePicked = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] || null;
    setImportFile(f);
    if (f && !importName) setImportName(f.name.replace(/\.[^/.]+$/, ''));
    setImportMessage(null);
  };

  const stats = workoutService.getStats();

  const handleImportRoute = async () => {
    setImportMessage(null);
    if (!importFile) {
      setImportMessage('No file selected');
      return;
    }
    const extension = importFile.name.split('.').pop()?.toLowerCase();
    const reader = new FileReader();
    reader.onload = async () => {
      const content = reader.result as string;
      try {
        let newRoute: WaterRoute | undefined = undefined;
        if (extension === 'gpx') {
          newRoute = routeService.importRouteFromGPX(content, { name: importName, difficulty: importDifficulty, location: importLocation }, importForce);
        } else if (extension === 'geojson' || extension === 'json') {
          newRoute = routeService.importRouteFromGeoJSON(content, { name: importName, difficulty: importDifficulty, location: importLocation }, importForce);
        } else {
          setImportMessage('Unsupported file type. Use .gpx or .geojson');
          return;
        }

        if (!newRoute) {
          setImportMessage('Route not accepted: data may not be in water. Toggle "Force" to import anyway.');
          return;
        }

        // refresh
        const allRoutes = routeService.getAllRoutes();
        setRoutes(allRoutes);
        setSelectedRoute(newRoute);
        setImportMessage('Route imported successfully');
        setImportFile(null);
      } catch (e) {
        setImportMessage('Failed to import: ' + (e as Error).message);
      }
    };
    reader.readAsText(importFile);
  };

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
          <div className="import-panel">
            <h3 className="panel-title">Import Route</h3>
            <input type="file" accept=".gpx,.geojson,.json" onChange={handleFilePicked} />
            <input type="text" className="input" value={importName} onChange={(e) => setImportName(e.target.value)} placeholder="Route Name" />
            <input type="text" className="input" value={importLocation} onChange={(e) => setImportLocation(e.target.value)} placeholder="Location" />
            <select value={importDifficulty} onChange={(e) => setImportDifficulty(e.target.value as any)} className="input">
              <option value="easy">Easy</option>
              <option value="moderate">Moderate</option>
              <option value="hard">Hard</option>
            </select>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <input type="checkbox" id="force" checked={importForce} onChange={(e) => setImportForce(e.target.checked)} />
              <label htmlFor="force">Force import (allow routes not detected as water)</label>
            </div>
            <button className="btn" onClick={handleImportRoute}>Import</button>
            {importMessage && (<div className="import-message">{importMessage}</div>)}
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
                </div>

                <div className="route-tags">
                  {selectedRoute.tags.map((tag) => (
                    <span key={tag} className="tag">
                      {tag}
                    </span>
                  ))}
                </div>

                <button
                  className="btn btn-start-workout"
                  onClick={handleStartWorkout}
                  disabled={!pm5Connected}
                >
                  {pm5Connected ? '▶ Start Workout' : '⚠ Connect PM5 First'}
                </button>

                <div className="routes-list">
                  <h3>Other Routes</h3>
                  {routes.map((route) => (
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

          {currentView === 'workout' && isWorkoutActive && currentSession && (
            <div className="view-container workout-view">
              <div className="workout-header">
                <h2>Active Workout</h2>
                <p className="route-name">{currentSession.routeName}</p>
              </div>

              {/* 3D scene takes the main view, while we overlay route map and metrics */}
              <div className="map-container three-map-container">
                <Rower3D route={selectedRoute!} paceSPer500={pm5Data?.pace ? (pm5Data.pace/100) : undefined} distanceMeters={pm5Data?.distance} isPlaying={isWorkoutActive} cadence={pm5Data?.cadence} performanceMode={(window as any).__PLAYWRIGHT_TESTING ? 'low' : 'auto'} />
                <div className="overlay-map">
                  <RouteMap route={selectedRoute!} onRouteSelected={handleRouteSelect} highlightMode={true} />
                </div>
                <MiniMetrics pm5Data={pm5Data} heartRate={heartRateSamples.length > 0 ? heartRateSamples[heartRateSamples.length - 1].bpm : null} />
              </div>

              {pm5Data && (
                <div className="workout-metrics">
                  <div className="metric-card">
                    <span className="metric-title">Pace</span>
                    <span className="metric-large">
                      {(pm5Data.pace / 100).toFixed(1)}
                    </span>
                    <span className="metric-unit">s/500m</span>
                  </div>
                  <div className="metric-card">
                    <span className="metric-title">Distance</span>
                    <span className="metric-large">
                      {(pm5Data.distance / 1000).toFixed(2)}
                    </span>
                    <span className="metric-unit">km</span>
                  </div>
                  <div className="metric-card">
                    <span className="metric-title">Time</span>
                    <span className="metric-large">
                      {formatTime(pm5Data.elapsedTime)}
                    </span>
                  </div>
                  <div className="metric-card">
                    <span className="metric-title">Power</span>
                    <span className="metric-large">
                      {pm5Data.power || 0}
                    </span>
                    <span className="metric-unit">W</span>
                  </div>
                  <div className="metric-card">
                    <span className="metric-title">Cadence</span>
                    <span className="metric-large">
                      {pm5Data.cadence || 0}
                    </span>
                    <span className="metric-unit">spm</span>
                  </div>
                  {heartRateSamples.length > 0 && (
                    <div className="metric-card">
                      <span className="metric-title">Heart Rate</span>
                      <span className="metric-large">{heartRateSamples[heartRateSamples.length - 1].bpm}</span>
                      <span className="metric-unit">bpm</span>
                    </div>
                  )}
                </div>
              )}
              {heartRateSamples.length > 0 && (
                <div className="hr-chart-section">
                  <h3>Heart Rate Trend</h3>
                  <HeartRateChart samples={heartRateSamples} />
                </div>
              )}

              <button className="btn btn-end-workout" onClick={handleEndWorkout}>
                ⏹ End Workout
              </button>
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
                    .map((session) => (
                      <div key={session.id} className="history-item">
                        <div className="history-header">
                          <h3>{session.routeName}</h3>
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
                      </div>
                    ))}
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
