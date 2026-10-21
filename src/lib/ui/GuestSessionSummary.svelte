<!--
  GuestSessionSummary (issue #221, ported to Svelte for #542 P1). The
  end-of-session summary for a guest (or a signed-out demo): the copy is about
  what signing in would have kept. No upload — a guest has nothing to save to.
  DOM, class names and copy kept verbatim vs the React component so the
  Playwright guest-summary selectors keep resolving.
-->
<script lang="ts">
  import type { WorkoutSession } from '../types/index';
  import { formatPace } from '../utils/formatters';
  import RowBreakdown from './RowBreakdown.svelte';
  import './GuestSessionSummary.css';

  interface Props {
    session: WorkoutSession;
    onRowAgain: () => void;
    onExit: () => void;
    /** Sign in from the summary. Omitted when there is nothing to sign in to. */
    onSignIn?: () => void;
    /** True when the session ran on simulated devices, so it is never read as a real row. */
    isDemo?: boolean;
  }

  let { session, onRowAgain, onExit, onSignIn, isDemo }: Props = $props();

  function formatDuration(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) {
      return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  const distanceKm = $derived((session.distance / 1000).toFixed(2));
  const avgHR = $derived(
    session.heartRateAvg ??
      (session.heartRateSamples && session.heartRateSamples.length > 0
        ? Math.round(session.heartRateSamples.reduce((s, h) => s + h.bpm, 0) / session.heartRateSamples.length)
        : null),
  );
  const maxHR = $derived(
    session.heartRateMax ??
      (session.heartRateSamples && session.heartRateSamples.length > 0
        ? session.heartRateSamples.reduce((m, h) => Math.max(m, h.bpm), 0)
        : null),
  );

  // Name exactly the stats this summary is showing, so the offer matches what
  // the visitor can actually see they are about to lose.
  const preservedList = $derived.by(() => {
    const preserved = [
      'distance',
      'time',
      'average pace',
      'calories',
      ...(avgHR !== null || maxHR !== null ? ['heart rate'] : []),
    ];
    return `${preserved.slice(0, -1).join(', ')} and ${preserved[preserved.length - 1]}`;
  });
</script>

<div class="guest-summary-backdrop" role="dialog" aria-modal="true" aria-labelledby="guest-summary-title">
  <div class="guest-summary-modal">
    <div class="guest-summary-header">
      <span class="guest-badge">{isDemo ? 'Demo Row' : 'Guest Session'}</span>
      <h2 id="guest-summary-title">Session Complete</h2>
      <p class="guest-summary-route">{session.routeName}</p>
      <p class="guest-summary-unsaved">
        {isDemo
          ? 'This was a demo on simulated data, and nothing has been saved.'
          : 'This session has not been saved.'}
        Signing in with intervals.icu would have kept your {preservedList} for this row.
      </p>
    </div>

    <div class="guest-summary-stats">
      <div class="guest-stat">
        <span class="guest-stat-label">Distance</span>
        <span class="guest-stat-value">{distanceKm} km</span>
      </div>
      <div class="guest-stat">
        <span class="guest-stat-label">Time</span>
        <span class="guest-stat-value">{formatDuration(session.duration)}</span>
      </div>
      <div class="guest-stat">
        <span class="guest-stat-label">Avg Pace</span>
        <span class="guest-stat-value">{formatPace(session.averagePace)}<span class="guest-stat-unit">/500m</span></span>
      </div>
      <div class="guest-stat">
        <span class="guest-stat-label">Calories</span>
        <span class="guest-stat-value">{session.calories} <span class="guest-stat-unit">kcal</span></span>
      </div>
      {#if avgHR !== null}
        <div class="guest-stat">
          <span class="guest-stat-label">Avg HR</span>
          <span class="guest-stat-value">{avgHR} <span class="guest-stat-unit">bpm</span></span>
        </div>
      {/if}
      {#if maxHR !== null}
        <div class="guest-stat">
          <span class="guest-stat-label">Max HR</span>
          <span class="guest-stat-value">{maxHR} <span class="guest-stat-unit">bpm</span></span>
        </div>
      {/if}
    </div>

    <!-- No comparison with a best: a guest has no history to keep one in. -->
    <RowBreakdown {session} />

    <div class="guest-summary-actions">
      {#if onSignIn}
        <button class="btn btn-guest-sign-in" onclick={onSignIn} type="button">
          🔑 Sign in to save future rows
        </button>
      {/if}
      <button class="btn btn-guest-row-again" onclick={onRowAgain} type="button">
        ▶ Row Again
      </button>
      <button class="btn btn-guest-exit" onclick={onExit} type="button">
        Done
      </button>
    </div>
  </div>
</div>
