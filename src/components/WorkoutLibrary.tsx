import React, { useState } from 'react';
import type { StructuredWorkout } from '../types/index';
import type { ImportOutcome } from '../hooks/useStructuredWorkout';
import {
  intensityColor,
  intensityLabel,
  summariseWorkout,
} from '../utils/workoutPlan';

/**
 * The workout library: what is available to row, which one is chosen, and the
 * intervals.icu import that adds to it (issue #67 §1 and §7).
 */

export interface WorkoutLibraryProps {
  library: StructuredWorkout[];
  selected: StructuredWorkout | null;
  onSelect: (id: string | null) => void;
  /** Why the selected workout cannot start, from `validateWorkout`. */
  validationErrors: string[];
  onImport: (apiKey: string, athleteId: string, workoutId: string) => Promise<ImportOutcome>;
}

/** `600` → `10:00`; `3725` → `1:02:05`. */
const formatDuration = (totalSeconds: number): string => {
  const seconds = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(rest)}` : `${minutes}:${pad(rest)}`;
};

const WorkoutCard: React.FC<{
  workout: StructuredWorkout;
  isSelected: boolean;
  onSelect: (id: string | null) => void;
}> = ({ workout, isSelected, onSelect }) => {
  const summary = summariseWorkout(workout);

  return (
    <li className={`workout-card${isSelected ? ' is-selected' : ''}`} aria-current={isSelected}>
      <div className="workout-card-head">
        <h4 className="workout-card-name">{workout.name}</h4>
        {workout.source === 'intervals.icu' && (
          <span className="workout-card-badge">intervals.icu</span>
        )}
      </div>

      {workout.description && <p className="workout-card-desc">{workout.description}</p>}

      <p className="workout-card-meta">
        <span>{summary.segmentCount} segment{summary.segmentCount === 1 ? '' : 's'}</span>
        {summary.totalDurationSec > 0 && <span>{formatDuration(summary.totalDurationSec)}</span>}
        {summary.totalDistanceMeters !== undefined && (
          <span>{summary.totalDistanceMeters.toLocaleString('en-GB')} m</span>
        )}
      </p>

      {/* The shape of the session at a glance, before committing to it. */}
      <div className="workout-card-shape" aria-hidden="true">
        {summariseSegments(workout).map((band, index) => (
          <span
            key={index}
            className="workout-card-band"
            style={{ flexGrow: band.weight, backgroundColor: intensityColor(band.intensity) }}
            title={intensityLabel(band.intensity)}
          />
        ))}
      </div>

      {isSelected ? (
        <button type="button" className="btn btn-workout-clear" onClick={() => onSelect(null)}>
          Free row instead
        </button>
      ) : (
        <button type="button" className="btn btn-workout-select" onClick={() => onSelect(workout.id)}>
          Use this workout
        </button>
      )}
    </li>
  );
};

/** Segments as weighted bands, so the preview bar is proportional to the row. */
const summariseSegments = (workout: StructuredWorkout) => {
  const expanded = workout.segments.flatMap((segment) =>
    segment.repeat && segment.repeat > 1
      ? Array.from({ length: segment.repeat }, () => segment)
      : [segment],
  );
  return expanded.map((segment) => ({
    intensity: segment.intensity,
    weight: Math.max(1, segment.duration ?? segment.distance ?? 1),
  }));
};

export const WorkoutLibrary: React.FC<WorkoutLibraryProps> = ({
  library,
  selected,
  onSelect,
  validationErrors,
  onImport,
}) => {
  const [apiKey, setApiKey] = useState('');
  const [athleteId, setAthleteId] = useState('');
  const [workoutId, setWorkoutId] = useState('');
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importedName, setImportedName] = useState<string | null>(null);

  const canImport =
    apiKey.trim() !== '' && athleteId.trim() !== '' && workoutId.trim() !== '' && !importing;

  const submitImport = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canImport) return;

    setImporting(true);
    setImportError(null);
    setImportedName(null);

    const outcome = await onImport(apiKey.trim(), athleteId.trim(), workoutId.trim());

    setImporting(false);
    if (outcome.ok) {
      // Keep the credentials — a rower importing one workout usually imports
      // several — but clear the id that has just been used.
      setWorkoutId('');
      setImportedName(outcome.workout?.name ?? 'Workout');
    } else {
      setImportError(outcome.error ?? 'Import failed.');
    }
  };

  return (
    <section className="workout-library">
      <header className="workout-library-head">
        <h3>Workouts</h3>
        <p className="workout-library-hint">
          Pick one to follow on your next row, or row freely with none selected.
        </p>
      </header>

      {validationErrors.length > 0 && (
        <div className="workout-validation" role="alert">
          <strong>This workout cannot be started:</strong>
          <ul>
            {validationErrors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        </div>
      )}

      {library.length === 0 ? (
        <p className="workout-library-empty">No workouts yet — import one from intervals.icu below.</p>
      ) : (
        <ul className="workout-list">
          {library.map((workout) => (
            <WorkoutCard
              key={workout.id}
              workout={workout}
              isSelected={selected?.id === workout.id}
              onSelect={onSelect}
            />
          ))}
        </ul>
      )}

      <form className="workout-import" onSubmit={submitImport}>
        <h4>Import from intervals.icu</h4>

        <label htmlFor="workout-import-key">API key</label>
        <input
          id="workout-import-key"
          type="password"
          autoComplete="off"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
        />

        <label htmlFor="workout-import-athlete">Athlete ID</label>
        <input
          id="workout-import-athlete"
          type="text"
          autoComplete="off"
          value={athleteId}
          onChange={(e) => setAthleteId(e.target.value)}
        />

        <label htmlFor="workout-import-workout">Workout ID</label>
        <input
          id="workout-import-workout"
          type="text"
          autoComplete="off"
          value={workoutId}
          onChange={(e) => setWorkoutId(e.target.value)}
        />

        <button type="submit" className="btn btn-workout-import" disabled={!canImport}>
          {importing ? 'Importing…' : 'Import'}
        </button>

        {importError && (
          <p className="workout-import-error" role="alert">
            {importError}
          </p>
        )}
        {importedName && <p className="workout-import-ok">Imported “{importedName}”.</p>}
      </form>
    </section>
  );
};
