<!--
  #573 P8 post-fx smoke page. Mounts the WebGPU engine with the full post
  chain (bloom + ACES + LUT + vignette; SSAO only on high+; DOF only on
  extra-high + `__VIRTUALROW_POSTFX_DOF` flag). The Playwright spec loads
  this to assert `data-backend="webgpu"` and that a frame draws.
-->
<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { attach, type RideRenderer } from '../../../lib/renderer';

  let canvas: HTMLCanvasElement | null = null;
  let renderer: RideRenderer | null = null;
  let status = 'pending';

  onMount(async () => {
    if (!canvas) return;
    const r = await attach(canvas, { testMode: true, tier: 'high' });
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

<main data-testid="webgpu-postfx-smoke" data-status={status}>
  <h1>WebGPU post-fx smoke</h1>
  <canvas bind:this={canvas} width="320" height="240" style="width: 320px; height: 240px"></canvas>
</main>
