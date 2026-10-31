<!--
  The below-rower block panel (issue #445, FR4), Svelte-runes port of
  WorkoutBlockPanel.tsx for the #542 UI-shell rebuild.

  Pinned to the bottom of the row stage (D5(a)), it carries the workout's
  context while the rower rows: the block timeline, a current-block card with
  the block's label / type / intensity / prescribed targets / elapsed and
  remaining seconds, and two "prescribed vs actual" tiles — pace and power —
  that read out the athlete's live number under the block's prescribed value
  (D4(b)).

  The panel only *reads* the port-independent workout state; the FTMS / PM5
  control loop lives in the target controller and writes to the port, so the
  two never fight over the same source of truth (AC8). DOM, classes and copy
  are kept verbatim from the React component so the Playwright selectors keep
  resolving (AC2).
-->
<script lang="ts">
  import type { StructuredWorkout, WorkoutProgress, WorkoutSegment } from '../types/index';
  import {
    COMPLIANCE_LABELS,
    complianceOf,
    intensityColor,
    intensityLabel,
    intensityMark,
    segmentTypeLabel,
  } from '../utils/workoutPlan';
  import { formatSplit } from '../utils/formatters';
  import './WorkoutBlockPanel.css';

  interface Props {
    workout: StructuredWorkout;
    /** The workout's segments with repeats expanded, in the order they are rowed. */
    segments: WorkoutSegment[];
    progress: WorkoutProgress;
    /**
     * Live pace in seconds per 500 m, or `null` before the first stroke lands.
     * The pace tile shows `—` for actual until this is a positive number.
     */
    currentPaceSecondsPer500: number | null;
    /** Live instantaneous power in watts, or `null` before the first stroke. */
    currentPowerWatts: number | null;
    /**
     * `false` when the ergometer has dropped out, so progress has stalled. The
     * panel keeps rendering but the compliance badge is hidden so a stale "on
     * target" tick does not read as truth.
     */
    deviceConnected: boolean;
    /**
     * `true` when the loaded workout is the signed-out demo-route placeholder
     * (#472 D8a). Shows a visible "Sample workout" prefix and lower-opacity
     * current-block card so the guest can tell this is a sample, not a plan
     * their coach pushed. Defaults false so every existing caller keeps the
     * verbatim DOM Playwright specs assert against.
     */
    isDemo?: boolean;
  }

  let {
    workout,
    segments,
    progress,
    currentPaceSecondsPer500,
    currentPowerWatts,
    deviceConnected,
    isDemo = false,
  }: Props = $props();

  const NO_TARGET_LABEL = '—';

  /** Weight for a timeline step, so a long segment draws wider than a short one. */
  const stepWeight = (segment: WorkoutSegment): number =>
    Math.max(1, segment.duration ?? segment.distance ?? 1);

  const segmentTitle = (segment: WorkoutSegment): string =>
    segment.description?.trim() || segmentTypeLabel(segment.type);

  const formatSeconds = (seconds: number): string => {
    const clamped = Math.max(0, Math.round(seconds));
    const m = Math.floor(clamped / 60);
    const s = clamped % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  };

  const formatPaceValue = (secondsPer500: number | null | undefined): string =>
    typeof secondsPer500 === 'number' && secondsPer500 > 0
      ? formatSplit(secondsPer500)
      : NO_TARGET_LABEL;

  const formatPowerValue = (watts: number | null | undefined): string =>
    typeof watts === 'number' && watts > 0 ? `${Math.round(watts)} W` : NO_TARGET_LABEL;

  const formatPaceBand = (min?: number, max?: number): string => {
    if (typeof min === 'number' && typeof max === 'number') {
      if (min === max) return formatSplit(min);
      return `${formatSplit(min)}–${formatSplit(max)}`;
    }
    if (typeof min === 'number') return formatSplit(min);
    if (typeof max === 'number') return formatSplit(max);
    return NO_TARGET_LABEL;
  };

  const segment = $derived(progress.currentSegment);
  const compliance = $derived(complianceOf(progress, segment));
  const finished = $derived(progress.isComplete === true);
  const totalDuration = $derived(segment.duration ?? 0);
  const remaining = $derived(Math.max(0, totalDuration - progress.segmentElapsedTime));

  const prescribedPace = $derived(formatPaceBand(segment.targetPaceMin, segment.targetPaceMax));
  const prescribedPower = $derived(
    typeof segment.targetPower === 'number'
      ? `${Math.round(segment.targetPower)} W`
      : NO_TARGET_LABEL,
  );
  const hasPaceTarget = $derived(prescribedPace !== NO_TARGET_LABEL);
  const hasPowerTarget = $derived(prescribedPower !== NO_TARGET_LABEL);
</script>

<!-- Keep the explicit role verbatim from the React component (AC2); a <section>
     with a label is implicitly a region, so Svelte flags it as redundant. -->
<!-- svelte-ignore a11y_no_redundant_roles -->
<section
  class="workout-block-panel{isDemo ? ' workout-block-panel--demo' : ''}"
  role="region"
  aria-label={`Workout block panel — ${isDemo ? 'Sample workout — ' : ''}${workout.name}`}
>
  {#if isDemo}
    <p class="workout-block-sample-prefix" data-testid="workout-block-sample-prefix">
      Sample workout
    </p>
  {/if}
  <ol class="workout-block-timeline" aria-label="Workout timeline">
    {#each segments as step, index (`${step.id}-${index}`)}
      <li
        class="workout-block-timeline-step{index === progress.currentSegmentIndex ? ' is-current' : ''}"
        aria-current={index === progress.currentSegmentIndex ? 'step' : undefined}
        style="flex-grow: {stepWeight(step)}; background-color: {intensityColor(step.intensity)};"
        title={`${segmentTitle(step)} — ${intensityLabel(step.intensity)}`}
      >
        <span class="workout-block-timeline-mark" aria-hidden="true">
          {intensityMark(step.intensity)}
        </span>
        <span class="sr-only">
          {`${segmentTitle(step)} — ${intensityLabel(step.intensity)}`}
        </span>
      </li>
    {/each}
  </ol>

  <div class="workout-block-body">
    <div class="workout-block-card{isDemo ? ' workout-block-card--demo' : ''}">
      <div class="workout-block-card-head">
        <span class="workout-block-zone" style="background-color: {intensityColor(segment.intensity)};">
          {intensityLabel(segment.intensity)}
        </span>
        <span class="workout-block-name">{segmentTitle(segment)}</span>
        <span class="workout-block-type">{segmentTypeLabel(segment.type)}</span>
      </div>
      <div class="workout-block-timing">
        <span>Elapsed {formatSeconds(progress.segmentElapsedTime)}</span>
        <span>Remaining {formatSeconds(remaining)}</span>
      </div>
      {#if deviceConnected && !finished}
        <p class="workout-block-compliance" role="status" data-compliance={compliance}>
          {COMPLIANCE_LABELS[compliance]}
        </p>
      {/if}
      {#if finished}
        <p class="workout-block-done">Workout complete</p>
      {/if}
    </div>

    <div class="workout-block-tile" data-metric="pace">
      <span class="workout-block-tile-label">Pace</span>
      <span class="workout-block-tile-prescribed">{prescribedPace}</span>
      <span
        class="workout-block-tile-actual"
        aria-live="polite"
        aria-atomic="true"
        data-has-target={hasPaceTarget}
      >
        {formatPaceValue(currentPaceSecondsPer500)}
      </span>
    </div>

    <div class="workout-block-tile" data-metric="power">
      <span class="workout-block-tile-label">Power</span>
      <span class="workout-block-tile-prescribed">{prescribedPower}</span>
      <span
        class="workout-block-tile-actual"
        aria-live="polite"
        aria-atomic="true"
        data-has-target={hasPowerTarget}
      >
        {formatPowerValue(currentPowerWatts)}
      </span>
    </div>
  </div>
</section>
