<!--
  FinishBanner (#336, ported to Svelte for #542 P1). The distance and time shown
  when the boat crosses the line. Presentational; `role="status"`. DOM, class
  names, data-testid and copy kept verbatim so the Playwright finish-banner
  selectors keep resolving.
-->
<script lang="ts">
  import { formatCourseMetres, formatTime } from '../utils/formatters';
  import './RaceCallouts.css';

  interface Props {
    distanceMeters: number;
    elapsedMs: number;
  }

  let { distanceMeters, elapsedMs }: Props = $props();
</script>

<div class="race-callout race-callout--finish" role="status" data-testid="finish-banner">
  <span class="race-callout-prompt">
    Finished — {formatCourseMetres(distanceMeters)} m in {formatTime(elapsedMs)}
  </span>
</div>
