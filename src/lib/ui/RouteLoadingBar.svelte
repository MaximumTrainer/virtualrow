<!--
  RouteLoadingBar (#318, ported to Svelte for #542 P1). How much of the route
  load is done, sitting over the stage while the scene assembles. Presentational:
  it takes the current LoadProgress and owns only its own dismissal hold. DOM,
  class names, ARIA and copy are kept verbatim so the Playwright progressbar
  selectors keep resolving.
-->
<script lang="ts">
  import type { LoadProgress } from '../utils/loadingProgress';
  import { BOAT_UNAVAILABLE_MESSAGE } from '../utils/loadingProgress';
  import './RouteLoadingBar.css';

  /**
   * How long the filled bar stays up once the wait is over, so it shows the
   * finish instead of jumping from its last phase straight to nothing (#318).
   * This delays the dismissal only; the value itself still moves only when a
   * phase settles.
   */
  const FINISHED_HOLD_MS = 400;

  interface Props {
    progress: LoadProgress;
  }

  let { progress }: Props = $props();

  const boatMissing = $derived(progress.failed.includes('boat'));

  // Held true only on the not-complete → complete transition (as the React
  // component set it from a wasComplete flip), then released by the timer
  // below. A plain let, not reactive, so the effect does not re-run on it.
  // svelte-ignore state_referenced_locally
  let prevComplete = progress.complete;
  let held = $state(false);

  $effect(() => {
    const complete = progress.complete;
    if (prevComplete !== complete) {
      prevComplete = complete;
      held = complete;
    }
    if (!complete) return;
    const timer = setTimeout(() => {
      held = false;
    }, FINISHED_HOLD_MS);
    return () => clearTimeout(timer);
  });

  const showBar = $derived(!progress.complete || held);
</script>

{#if showBar || boatMissing}
  <div class="route-loading" data-loaded={progress.complete ? 'loaded' : 'loading'}>
    {#if showBar}
      <div
        class="route-loading-bar"
        role="progressbar"
        aria-label="Loading the 3D view"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progress.percent}
        aria-valuetext={progress.phase}
      >
        <div class="route-loading-fill" style="width: {progress.percent}%"></div>
      </div>

      <p class="route-loading-phase">
        {progress.phase}
        <span class="route-loading-percent"> {progress.percent}%</span>
      </p>
    {/if}

    {#if boatMissing}
      <p class="route-loading-warning" role="status">
        {BOAT_UNAVAILABLE_MESSAGE}
      </p>
    {/if}
  </div>
{/if}
