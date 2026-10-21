<!--
  #555 P3 scenery smoke page (D7-a). Mounts the WebGPU engine with a canned
  SceneryRoute of ~400 foliage trees across 5 chunks so the Playwright smoke
  can read `__ROWER3D_SCENERY` + the per-pool counts. Same hidden-route
  convention as /smoke/engine from #550: no UI link points here.
-->
<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { attach, buildSmokeFoliagePools, type RideRenderer } from '../../../lib/renderer';

  let canvas: HTMLCanvasElement | null = null;
  let renderer: RideRenderer | null = null;
  let status = 'pending';
  let poolCount = 0;

  onMount(async () => {
    if (!canvas) return;
    const pools = buildSmokeFoliagePools({
      speciesCount: 2,
      chunkCount: 5,
      perChunk: 40,
    });
    poolCount = pools.length;
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

<main data-testid="webgpu-scenery-smoke" data-status={status} data-pools={poolCount}>
  <h1>WebGPU scenery smoke</h1>
  <canvas bind:this={canvas} width="320" height="240" style="width: 320px; height: 240px"></canvas>
</main>
