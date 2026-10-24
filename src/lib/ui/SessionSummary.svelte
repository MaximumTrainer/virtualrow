<!--
  SessionSummary (issue #221, R4, ported to Svelte for #542 P1). The
  end-of-session summary for a signed-in athlete: the row is here, and the
  athlete decides whether it goes to their training log.

  A guest still gets GuestSessionSummary, whose copy is about what signing in
  would have kept; this is the other path. Neither a guest row nor a demo row
  can reach the upload (R5): the demo runs on simulated data and must never
  enter a real training log, so a signed-in demo keeps the download and loses
  the Save button.

  DOM, class names, data-testids and copy kept verbatim vs the React component
  so the Playwright session-summary selectors keep resolving. Auth and services
  come from context (the React useAuth / useServices).
-->
<script lang="ts">
  import type { ActivitySample, GeometrySource, WorkoutSession } from '../types/index';
  import type { ActivityUploadResult } from '../services/intervalsIcuActivityService';
  import { getAuth } from './authContext';
  import { getServices } from './servicesContext';
  import { activityFileName, triggerBlobDownload } from '../utils/exporters';
  import { formatPace } from '../utils/formatters';
  import RowBreakdown from './RowBreakdown.svelte';
  import GhostVerdict from './GhostVerdict.svelte';
  import './SessionSummary.css';

  interface Props {
    session: WorkoutSession;
    /** Dismiss the summary and return to the Row screen. */
    onDone: () => void;
    /** Called with the intervals.icu activity id once the row is saved. */
    onSaved?: (activityId: string) => void;
    /** True when the row ran on simulated devices. */
    isDemo?: boolean;
    /**
     * The athlete's best average split on this route before this row, null on
     * a first row (#337). Left out, the comparison is not shown.
     */
    personalBest?: number | null;
    /**
     * The boat this row was raced against (#338): how long it took to the same
     * distance, and what it was. Left out, no race is reported.
     */
    ghost?: { seconds: number | null; label: string } | null;
    /**
     * How the rowed route's polyline came to be (#466, D2(a)). When the source
     * is `gate-chain`, the GPS trace saved to the FIT file is a straight line
     * between the start and finish gates — surface a persistent chip saying so.
     */
    routeGeometrySource?: GeometrySource;
  }

  let { session, onDone, onSaved, isDemo, personalBest, ghost, routeGeometrySource }: Props = $props();

  /** Where the save has got to. */
  type SaveState =
    | { phase: 'idle' }
    | { phase: 'saving' }
    | { phase: 'saved'; activityUrl: string; wasAlreadySaved: boolean }
    | { phase: 'error'; message: string };

  const auth = getAuth();
  const { intervalsIcuActivityService, authService } = getServices();
  let save = $state<SaveState>({ phase: 'idle' });

  function formatDuration(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  function averageOf(
    samples: ActivitySample[],
    pick: (sample: ActivitySample) => number | undefined,
  ): number | null {
    const values = samples.map(pick).filter((value): value is number => value !== undefined);
    if (values.length === 0) return null;
    return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
  }

  /** The FIT bytes for this row. Encoder is dynamically imported so it stays out of the main chunk. */
  async function encode(s: WorkoutSession): Promise<Uint8Array> {
    const { encodeSession } = await import('../services/fitEncoderService');
    return encodeSession(s);
  }

  const canUpload = $derived(auth.isAuthenticated && !isDemo && !session.isGuest);
  const hasSamples = $derived(session.samples.length > 0);
  const averagePower = $derived(averageOf(session.samples, (s) => s.power));
  const isSaved = $derived(save.phase === 'saved');

  async function handleSave() {
    if (!canUpload || !hasSamples || save.phase === 'saving') return;
    save = { phase: 'saving' };

    // Rebuilt from the session on every attempt, so a retry after a network
    // failure can never resend a partial body (AC3.6).
    const bytes = await encode(session);
    const result: ActivityUploadResult = await intervalsIcuActivityService.uploadActivity(
      session,
      bytes,
      authService,
    );

    if (result.status === 'uploaded' || result.status === 'already-uploaded') {
      save = {
        phase: 'saved',
        activityUrl: result.activityUrl,
        wasAlreadySaved: result.status === 'already-uploaded',
      };
      onSaved?.(result.activityId);
      return;
    }
    save = { phase: 'error', message: result.message };
  }

  async function handleDownload() {
    const bytes = await encode(session);
    triggerBlobDownload(bytes as BlobPart, 'application/octet-stream', activityFileName(session));
  }
</script>

<div class="session-summary-backdrop" role="dialog" aria-modal="true" aria-labelledby="session-summary-title">
  <div class="session-summary-modal">
    <div class="session-summary-header">
      {#if isDemo}<span class="session-summary-badge">Demo Row</span>{/if}
      <h2 id="session-summary-title">Workout complete</h2>
      <p class="session-summary-route">{session.routeName}</p>
      {#if routeGeometrySource === 'gate-chain'}
        <p class="session-summary-gate-chain-chip" role="note" aria-label="GPS trace note">
          GPS trace is a schematic line between start and finish — this route only knows its gates.
        </p>
      {/if}
    </div>

    <div class="session-summary-stats">
      <div class="session-stat">
        <span class="session-stat-label">Distance</span>
        <span class="session-stat-value">{(session.distance / 1000).toFixed(2)} km</span>
      </div>
      <div class="session-stat">
        <span class="session-stat-label">Time</span>
        <span class="session-stat-value">{formatDuration(session.duration)}</span>
      </div>
      <div class="session-stat">
        <span class="session-stat-label">Avg Pace</span>
        <span class="session-stat-value">{formatPace(session.averagePace)}</span>
      </div>
      {#if session.heartRateAvg !== undefined}
        <div class="session-stat">
          <span class="session-stat-label">Avg HR</span>
          <span class="session-stat-value">{session.heartRateAvg}<span class="session-stat-unit">bpm</span></span>
        </div>
      {/if}
      {#if session.heartRateMax !== undefined}
        <div class="session-stat">
          <span class="session-stat-label">Max HR</span>
          <span class="session-stat-value">{session.heartRateMax}<span class="session-stat-unit">bpm</span></span>
        </div>
      {/if}
      {#if averagePower !== null}
        <div class="session-stat">
          <span class="session-stat-label">Avg Power</span>
          <span class="session-stat-value">{averagePower}<span class="session-stat-unit">W</span></span>
        </div>
      {/if}
    </div>

    <!-- The race first: it is the question the row was rowed to (#338). -->
    {#if ghost}
      <GhostVerdict rowSeconds={session.duration} ghostSeconds={ghost.seconds} label={ghost.label} />
    {/if}

    <RowBreakdown {session} {personalBest} />

    {#if save.phase === 'error'}
      <p class="session-summary-error" role="alert">{save.message}</p>
    {/if}

    {#if isSaved && save.phase === 'saved'}
      <p class="session-summary-saved">
        {save.wasAlreadySaved ? 'This row was already saved to intervals.icu.' : 'Saved to intervals.icu.'}
        <a href={save.activityUrl} target="_blank" rel="noreferrer">View on intervals.icu</a>
      </p>
    {/if}

    {#if !isSaved && canUpload}
      <p class="session-summary-unsaved">
        This row has not been saved to intervals.icu. Dismissing it now loses it.
      </p>
    {/if}

    <div class="session-summary-actions">
      {#if canUpload && !isSaved}
        <button
          class="btn btn-session-save"
          onclick={handleSave}
          disabled={!hasSamples || save.phase === 'saving'}
          type="button"
        >
          {save.phase === 'saving' ? 'Saving…' : '☁ Save to intervals.icu'}
        </button>
      {/if}
      <div class="session-summary-secondary">
        <button class="btn btn-session-download" onclick={handleDownload} type="button">
          ⤓ Download .fit
        </button>
        <button class="btn btn-session-done" onclick={onDone} type="button">
          Done
        </button>
      </div>
    </div>
  </div>
</div>
