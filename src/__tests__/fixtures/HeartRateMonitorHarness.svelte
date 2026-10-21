<!--
  Test fixture (#542 P1): renders HeartRateMonitor through a parent that forwards
  the onSample callback, so a unit test can confirm the destructured callback
  props read live values when the service fires. Lives under src/__tests__
  (coverage-excluded).
-->
<script lang="ts">
  import HeartRateMonitor from '../../lib/ui/HeartRateMonitor.svelte';

  const props: { onSample?: (bpm: number) => void } = $props();
</script>

<HeartRateMonitor onSample={props.onSample} />
