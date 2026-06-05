import { useState } from 'react';
import type { StructuredWorkout } from '../types/index';
import { workoutGeneratorService } from '../services/workoutGeneratorService';
import { useAuth } from '../context/AuthContext';
import { authService } from '../services/authService';
import './WorkoutGenerator.css';

interface WorkoutGeneratorProps {
  onSelectWorkout: (workout: StructuredWorkout | null) => void;
  selectedWorkout: StructuredWorkout | null;
}

export function WorkoutGenerator({ onSelectWorkout, selectedWorkout }: WorkoutGeneratorProps) {
  const { user } = useAuth();
  const [workouts, setWorkouts] = useState<StructuredWorkout[]>(() => workoutGeneratorService.getAllWorkouts());
  const [showImportDialog, setShowImportDialog] = useState(false);
  // When authenticated, athlete ID is pre-filled; access token replaces API key
  const [importApiKey, setImportApiKey] = useState('');
  const [importAthleteId, setImportAthleteId] = useState(() => user?.id ?? '');
  const [importWorkoutId, setImportWorkoutId] = useState('');
  const [importing, setImporting] = useState(false);

  const isAuthenticatedImport = !!user && !!authService.getAccessToken();

  const handleSelectWorkout= (workout: StructuredWorkout) => {
    if (selectedWorkout?.id === workout.id) {
      onSelectWorkout(null);
    } else {
      onSelectWorkout(workout);
    }
  };

  const handleImport = async () => {
    // When authenticated, use access token (empty API key is acceptable)
    if (!isAuthenticatedImport && !importApiKey) {
      alert('Please fill in all fields');
      return;
    }
    if (!importAthleteId || !importWorkoutId) {
      alert('Please fill in all fields');
      return;
    }

    setImporting(true);
    const apiKey = isAuthenticatedImport
      ? (authService.getAccessToken() ?? '')
      : importApiKey;

    const imported = await workoutGeneratorService.importFromIntervalsICU(
      apiKey,
      importAthleteId,
      importWorkoutId
    );

    if (imported) {
      setWorkouts(workoutGeneratorService.getAllWorkouts());
      setShowImportDialog(false);
      setImportApiKey('');
      setImportAthleteId(user?.id ?? '');
      setImportWorkoutId('');
      alert(`Successfully imported: ${imported.name}`);
    } else {
      alert('Failed to import workout. Please check your credentials and workout ID.');
    }
    setImporting(false);
  };

  const formatDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const getIntensityColor = (intensity?: string): string => {
    const colorMap: Record<string, string> = {
      'recovery': '#90EE90',
      'zone1': '#87CEEB',
      'zone2': '#FFD700',
      'zone3': '#FFA500',
      'zone4': '#FF6347',
      'zone5': '#FF0000',
      'max': '#8B0000',
    };
    return intensity ? colorMap[intensity] || '#CCC' : '#CCC';
  };

  return (
    <div className="workout-generator">
      <div className="workout-generator-header">
        <h2>Structured Workouts</h2>
        <button
          className="import-button"
          onClick={() => setShowImportDialog(true)}
        >
          Import from intervals.icu
        </button>
      </div>

      {showImportDialog && (
        <div className="import-dialog-overlay">
          <div className="import-dialog">
            <h3>Import from intervals.icu</h3>
            <div className="import-form">
              {/* API key only needed when not using OAuth */}
              {!isAuthenticatedImport && (
                <label>
                  API Key:
                  <input
                    type="password"
                    value={importApiKey}
                    onChange={(e) => setImportApiKey(e.target.value)}
                    placeholder="Your intervals.icu API key"
                  />
                </label>
              )}
              {isAuthenticatedImport && (
                <p className="import-authenticated-note">
                  ✓ Signed in as <strong>{user!.name}</strong> — no API key needed.
                </p>
              )}
              <label>
                Athlete ID:
                <input
                  type="text"
                  value={importAthleteId}
                  onChange={(e) => setImportAthleteId(e.target.value)}
                  placeholder="Your athlete ID"
                  readOnly={isAuthenticatedImport}
                />
              </label>
              <label>
                Workout ID:
                <input
                  type="text"
                  value={importWorkoutId}
                  onChange={(e) => setImportWorkoutId(e.target.value)}
                  placeholder="Workout ID to import"
                />
              </label>
              <div className="import-actions">
                <button onClick={handleImport} disabled={importing}>
                  {importing ? 'Importing...' : 'Import'}
                </button>
                <button onClick={() => setShowImportDialog(false)}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="workout-list">
        {workouts.length === 0 ? (
          <p>No workouts available. Import one from intervals.icu!</p>
        ) : (
          workouts.map((workout) => (
            <div
              key={workout.id}
              className={`workout-card ${selectedWorkout?.id === workout.id ? 'selected' : ''}`}
              onClick={() => handleSelectWorkout(workout)}
            >
              <div className="workout-header">
                <h3>{workout.name}</h3>
                <span className="workout-type">{workout.type}</span>
              </div>
              <p className="workout-description">{workout.description}</p>
              <div className="workout-stats">
                <span>Duration: {formatDuration(workout.totalDuration)}</span>
                {workout.totalDistance && (
                  <span>Distance: {(workout.totalDistance / 1000).toFixed(2)}km</span>
                )}
                <span>Segments: {workout.segments.length}</span>
              </div>
              {workout.routeId && (
                <div className="workout-route-badge">
                  📍 {workout.routeId === '1' ? 'Venice' : workout.routeId === '2' ? 'Henley' : `Route ${workout.routeId}`}
                </div>
              )}
              {!workout.routeId && (
                <div className="workout-route-badge flexible">
                  🗺️ Any Route / No Route
                </div>
              )}
              {workout.source && (
                <span className="workout-source">Source: {workout.source}</span>
              )}
              
              <div className="workout-segments-preview">
                {workout.segments.map((segment) => (
                  <div
                    key={segment.id}
                    className="segment-bar"
                    style={{
                      backgroundColor: getIntensityColor(segment.intensity),
                      flex: segment.duration || 1,
                    }}
                    title={`${segment.type}: ${segment.description || ''}`}
                  />
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
