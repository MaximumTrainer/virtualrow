import { useCallback, useMemo, useState } from 'react';
import type { ActivitySample, WorkoutSession } from '../types/index';
import type { ActivityUploadResult } from '../services/intervalsIcuActivityService';
import { useAuth } from '../context/useAuth';
import { useServices } from '../context/useServices';
import { activityFileName, triggerBlobDownload } from '../utils/exporters';
import { formatPace } from '../utils/formatters';
import './SessionSummary.css';

/**
 * The end-of-session summary for a signed-in athlete (issue #221, R4).
 *
 * A guest still gets `GuestSessionSummary`, whose copy is about what signing
 * in would have kept; this is the other path — the row is here, and the
 * athlete decides whether it goes to their training log.
 *
 * Neither a guest row nor a demo row can reach the upload (R5): the demo runs
 * on simulated data and must never enter a real training log, so a signed-in
 * demo keeps the download and loses the Save button.
 */
interface SessionSummaryProps {
  session: WorkoutSession;
  /** Dismiss the summary and return to the Row screen. */
  onDone: () => void;
  /** Called with the intervals.icu activity id once the row is saved. */
  onSaved?: (activityId: string) => void;
  /** True when the row ran on simulated devices. */
  isDemo?: boolean;
}

/** Where the save has got to. */
type SaveState =
  | { phase: 'idle' }
  | { phase: 'saving' }
  | { phase: 'saved'; activityUrl: string; wasAlreadySaved: boolean }
  | { phase: 'error'; message: string };

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function averageOf(samples: ActivitySample[], pick: (sample: ActivitySample) => number | undefined): number | null {
  const values = samples.map(pick).filter((value): value is number => value !== undefined);
  if (values.length === 0) return null;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

/** The FIT bytes for this row. Encoder is dynamically imported so it stays out of the main chunk. */
async function encode(session: WorkoutSession): Promise<Uint8Array> {
  const { encodeSession } = await import('../services/fitEncoderService');
  return encodeSession(session);
}

export function SessionSummary({ session, onDone, onSaved, isDemo }: SessionSummaryProps) {
  const { isAuthenticated } = useAuth();
  const { intervalsIcuActivityService, authService } = useServices();
  const [save, setSave] = useState<SaveState>({ phase: 'idle' });

  const canUpload = isAuthenticated && !isDemo && !session.isGuest;
  const hasSamples = session.samples.length > 0;

  const averagePower = useMemo(() => averageOf(session.samples, (s) => s.power), [session.samples]);

  const handleSave = useCallback(async () => {
    if (!canUpload || !hasSamples || save.phase === 'saving') return;
    setSave({ phase: 'saving' });

    // Rebuilt from the session on every attempt, so a retry after a network
    // failure can never resend a partial body (AC3.6).
    const bytes = await encode(session);
    const result: ActivityUploadResult =
      await intervalsIcuActivityService.uploadActivity(session, bytes, authService);

    if (result.status === 'uploaded' || result.status === 'already-uploaded') {
      setSave({
        phase: 'saved',
        activityUrl: result.activityUrl,
        wasAlreadySaved: result.status === 'already-uploaded',
      });
      onSaved?.(result.activityId);
      return;
    }
    setSave({ phase: 'error', message: result.message });
  }, [authService, canUpload, hasSamples, intervalsIcuActivityService, onSaved, save.phase, session]);

  const handleDownload = useCallback(async () => {
    const bytes = await encode(session);
    triggerBlobDownload(bytes as BlobPart, 'application/octet-stream', activityFileName(session));
  }, [session]);

  const isSaved = save.phase === 'saved';

  return (
    <div className="session-summary-backdrop" role="dialog" aria-modal="true" aria-labelledby="session-summary-title">
      <div className="session-summary-modal">
        <div className="session-summary-header">
          {isDemo && <span className="session-summary-badge">Demo Row</span>}
          <h2 id="session-summary-title">Workout complete</h2>
          <p className="session-summary-route">{session.routeName}</p>
        </div>

        <div className="session-summary-stats">
          <Stat label="Distance" value={`${(session.distance / 1000).toFixed(2)} km`} />
          <Stat label="Time" value={formatDuration(session.duration)} />
          <Stat label="Avg Pace" value={formatPace(session.averagePace)} />
          {session.heartRateAvg !== undefined && <Stat label="Avg HR" value={session.heartRateAvg} unit="bpm" />}
          {session.heartRateMax !== undefined && <Stat label="Max HR" value={session.heartRateMax} unit="bpm" />}
          {averagePower !== null && <Stat label="Avg Power" value={averagePower} unit="W" />}
        </div>

        {save.phase === 'error' && (
          <p className="session-summary-error" role="alert">{save.message}</p>
        )}

        {isSaved && (
          <p className="session-summary-saved">
            {save.wasAlreadySaved ? 'This row was already saved to intervals.icu.' : 'Saved to intervals.icu.'}
            {' '}
            <a href={save.activityUrl} target="_blank" rel="noreferrer">View on intervals.icu</a>
          </p>
        )}

        {!isSaved && canUpload && (
          <p className="session-summary-unsaved">
            This row has not been saved to intervals.icu. Dismissing it now loses it.
          </p>
        )}

        <div className="session-summary-actions">
          {canUpload && !isSaved && (
            <button
              className="btn btn-session-save"
              onClick={handleSave}
              disabled={!hasSamples || save.phase === 'saving'}
              type="button"
            >
              {save.phase === 'saving' ? 'Saving…' : '☁ Save to intervals.icu'}
            </button>
          )}
          <div className="session-summary-secondary">
            <button className="btn btn-session-download" onClick={handleDownload} type="button">
              ⤓ Download .fit
            </button>
            <button className="btn btn-session-done" onClick={onDone} type="button">
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, unit }: { label: string; value: string | number; unit?: string }) {
  return (
    <div className="session-stat">
      <span className="session-stat-label">{label}</span>
      <span className="session-stat-value">
        {value}
        {unit && <span className="session-stat-unit">{unit}</span>}
      </span>
    </div>
  );
}
