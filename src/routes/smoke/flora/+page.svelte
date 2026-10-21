<!--
  #562 P5 flora smoke page. Mounts the WebGPU engine with a canned
  SceneryRoute so the Playwright smoke can read `__ROWER3D_TEXTURES` + the
  per-pass counts on `__ROWER3D_SCENERY` (spriteDraws / solidDraws / solidTriangles).
  The tier query param drives `sproutWindowFor` and the atlas kind decision
  (`high`+ → KTX2, lower → PNG, with the decoder stubbed to the PNG fallback).
-->
<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { attach, buildSmokeFoliagePools, type RideRenderer } from '../../../lib/renderer';
  import { page } from '$app/stores';

  let canvas: HTMLCanvasElement | null = null;
  let renderer: RideRenderer | null = null;
  let status = 'pending';
  let poolCount = 0;

  onMount(async () => {
    if (!canvas) return;
    const pools = buildSmokeFoliagePools({ speciesCount: 2, chunkCount: 3, perChunk: 30 });
    poolCount = pools.length;
    const tier = $page.url.searchParams.get('tier') ?? 'medium';
    const r = await attach(canvas, { testMode: true, route: { pools }, tier });
    if (r) {
      renderer = r;
      status = 'ready';
      // One extra tick so the lazy atlas load has a chance to resolve before
      // the smoke snapshots telemetry.
      await Promise.resolve();
    } else {
      status = 'unavailable';
    }
  });

  onDestroy(() => {
    renderer?.dispose();
    renderer = null;
  });
</script>

<main data-testid="webgpu-flora-smoke" data-status={status} data-pools={poolCount}>
  <h1>WebGPU flora LOD smoke</h1>
  <canvas bind:this={canvas} width="320" height="240" style="width: 320px; height: 240px"></canvas>
</main>
