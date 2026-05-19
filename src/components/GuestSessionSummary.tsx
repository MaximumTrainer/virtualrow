import type { WorkoutSession } from '../types/index';
import { formatPace } from '../utils/formatters';
import './GuestSessionSummary.css';

interface GuestSessionSummaryProps {
  session: WorkoutSession;
  onRowAgain: () => void;
  onExit: () => void;
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function GuestSessionSummary({ session, onRowAgain, onExit }: GuestSessionSummaryProps) {
  const distanceKm = (session.distance / 1000).toFixed(2);
  const avgHR = session.heartRateAvg ?? (
    session.heartRateSamples && session.heartRateSamples.length > 0
      ? Math.round(session.heartRateSamples.reduce((s, h) => s + h.bpm, 0) / session.heartRateSamples.length)
      : null
  );
  const maxHR = session.heartRateMax ?? (
    session.heartRateSamples && session.heartRateSamples.length > 0
      ? session.heartRateSamples.reduce((m, h) => Math.max(m, h.bpm), 0)
      : null
  );

  return (
    <div className="guest-summary-backdrop" role="dialog" aria-modal="true" aria-labelledby="guest-summary-title">
      <div className="guest-summary-modal">
        <div className="guest-summary-header">
          <span className="guest-badge">Guest Session</span>
          <h2 id="guest-summary-title">Session Complete</h2>
          <p className="guest-summary-route">{session.routeName}</p>
          <p className="guest-summary-unsaved">Stats are unsaved and will not be stored.</p>
        </div>

        <div className="guest-summary-stats">
          <div className="guest-stat">
            <span className="guest-stat-label">Distance</span>
            <span className="guest-stat-value">{distanceKm} km</span>
          </div>
          <div className="guest-stat">
            <span className="guest-stat-label">Time</span>
            <span className="guest-stat-value">{formatDuration(session.duration)}</span>
          </div>
          <div className="guest-stat">
            <span className="guest-stat-label">Avg Pace</span>
            <span className="guest-stat-value">{formatPace(session.averagePace)}<span className="guest-stat-unit">/500m</span></span>
          </div>
          <div className="guest-stat">
            <span className="guest-stat-label">Calories</span>
            <span className="guest-stat-value">{session.calories} <span className="guest-stat-unit">kcal</span></span>
          </div>
          {avgHR !== null && (
            <div className="guest-stat">
              <span className="guest-stat-label">Avg HR</span>
              <span className="guest-stat-value">{avgHR} <span className="guest-stat-unit">bpm</span></span>
            </div>
          )}
          {maxHR !== null && (
            <div className="guest-stat">
              <span className="guest-stat-label">Max HR</span>
              <span className="guest-stat-value">{maxHR} <span className="guest-stat-unit">bpm</span></span>
            </div>
          )}
        </div>

        <div className="guest-summary-actions">
          <button className="btn btn-guest-row-again" onClick={onRowAgain} type="button">
            ▶ Row Again
          </button>
          <button className="btn btn-guest-exit" onClick={onExit} type="button">
            Exit Guest Mode
          </button>
        </div>
      </div>
    </div>
  );
}
