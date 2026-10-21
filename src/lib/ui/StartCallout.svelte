<!--
  StartCallout (#336, ported to Svelte for #542 P1). What the rower is told at
  the start: "Ready", the 3-2-1, and "Row!". Presentational; `role="status"` so
  a screen reader hears the count. DOM, class names, data-testid and copy kept
  verbatim so the Playwright start-callout selectors keep resolving.
-->
<script lang="ts">
  import type { StartPhase } from './startPhase';
  import './RaceCallouts.css';

  interface Props {
    phase: StartPhase;
    countdown: number | null;
  }

  let { phase, countdown }: Props = $props();

  const text = $derived(
    phase === 'armed'
      ? 'Ready — take your first stroke'
      : phase === 'go'
        ? 'Row!'
        : String(countdown),
  );
</script>

{#if phase !== 'idle' && phase !== 'rowing'}
  <div class="race-callout" role="status" data-testid="start-callout" data-phase={phase}>
    <span class={phase === 'armed' ? 'race-callout-prompt' : 'race-callout-count'}>{text}</span>
  </div>
{/if}
