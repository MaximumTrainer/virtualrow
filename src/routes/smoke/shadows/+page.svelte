<!--
  #559 P4 shadows smoke page. Mounts the WebGPU engine with a canned
  foliage pool set so the shadow stage has casters, then exposes the
  shadow telemetry via `data-*` so a Playwright assertion can read it
  without evaluating page JS. Same hidden-route convention as
  /smoke/engine and /smoke/scenery: no UI link points here.
-->
<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { attach, buildSmokeFoliagePools, type RideRenderer } from '../../../lib/renderer';

  let canvas: HTMLCanvasElement | null = null;
  let renderer: RideRenderer | null = null;
  let status = 'pending';

  onMount(async () => {
    if (!canvas) return;
    const pools = buildSmokeFoliagePools({
      speciesCount: 2,
      chunkCount: 3,
      perChunk: 20,
    });
    const r = await attach(canvas, { testMode: true, route: { pools } });
    if (r) {
      renderer = r;
      status = 'ready';
    } else {
      status = 'unavailable';
    }
  });

  onDestroy(() => {
    renderer?.dispose();
    renderer = null;
  });
</script>

<main data-testid="webgpu-shadows-smoke" data-status={status}>
  <h1>WebGPU shadows smoke</h1>
  <canvas bind:this={canvas} width="320" height="240" style="width: 320px; height: 240px"></canvas>
</main>
