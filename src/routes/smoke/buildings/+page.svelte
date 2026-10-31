<!--
  #566 P6 buildings smoke page. Mounts the WebGPU engine with a canned
  SceneryRoute whose `buildings` array alternates all four profile colours
  along both banks, so the Playwright smoke can read
  `__ROWER3D_BUILDINGS.drawn > 0` + per-profile palette coverage. Same
  hidden-route convention as /smoke/engine from #550: no UI link points
  here.
-->
<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import {
    attach,
    buildSmokeBuildings,
    buildSmokeFoliagePools,
    type RideRenderer,
  } from '../../../lib/renderer';

  let canvas: HTMLCanvasElement | null = null;
  let renderer: RideRenderer | null = null;
  let status = 'pending';
  let buildingCount = 0;

  onMount(async () => {
    if (!canvas) return;
    const pools = buildSmokeFoliagePools({ speciesCount: 1, chunkCount: 2, perChunk: 20 });
    const buildings = buildSmokeBuildings({ count: 24 });
    buildingCount = buildings.length;
    const r = await attach(canvas, {
      testMode: true,
      tier: 'medium',
      route: { pools, buildings },
    });
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

<main data-testid="webgpu-buildings-smoke" data-status={status} data-buildings={buildingCount}>
  <h1>WebGPU buildings smoke</h1>
  <canvas bind:this={canvas} width="320" height="240" style="width: 320px; height: 240px"></canvas>
</main>
