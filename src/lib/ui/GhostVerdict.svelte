<!--
  GhostVerdict (#338, ported to Svelte for #542 P1). How the race came out,
  above the row's own numbers. The pace comparison (#337) answers "was this a
  good row"; this answers "did I beat the thing I was chasing". Presentational;
  `role="status"`. DOM, class names, data-result and copy kept verbatim so the
  Playwright racing-a-ghost selectors keep resolving.
-->
<script lang="ts">
  import { formatSplit } from '../utils/formatters';
  import './GhostVerdict.css';

  interface Props {
    /** Seconds the row took. */
    rowSeconds: number;
    /** Seconds the ghost took to the same distance, or null if it never got there. */
    ghostSeconds: number | null;
    /** What was being chased — "your best", "a 2:00 pace". Null when nothing was. */
    label: string | null;
  }

  let { rowSeconds, ghostSeconds, label }: Props = $props();

  /** Inside a second is a dead heat; a tenth either way is not a story. */
  const DEAD_HEAT_SECONDS = 1;

  // The margin and result only matter once the ghost reached the distance.
  const margin = $derived(ghostSeconds === null ? 0 : ghostSeconds - rowSeconds);
  const result = $derived(
    Math.abs(margin) < DEAD_HEAT_SECONDS ? 'level' : margin > 0 ? 'won' : 'lost',
  );
</script>

{#if label !== null}
  {#if ghostSeconds === null}
    <p class="ghost-verdict" data-result="unfinished" role="status">
      {label} did not reach this distance, so there was nothing to race to the line.
    </p>
  {:else}
    <p class="ghost-verdict" data-result={result} role="status">
      {#if result === 'level'}A dead heat with {label}.{/if}
      {#if result === 'won'}You beat {label} by {formatSplit(margin)}.{/if}
      {#if result === 'lost'}{label.charAt(0).toUpperCase()}{label.slice(1)} was {formatSplit(-margin)} quicker.{/if}
    </p>
  {/if}
{/if}
