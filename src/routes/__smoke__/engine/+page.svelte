<!--
  #550 P2 engine smoke page (D8-b of #550). Hidden route under /__smoke__/engine
  that mounts the WebGPU engine on a bare canvas. The Playwright smoke spec
  loads this to assert `data-backend="webgpu"`, the context state, and the
  frame counter. The UI thread's ride view is empty during P2 (#550 D6-a),
  so this is the only mount site until P7+.
-->
<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { attach, type RideRenderer } from '../../../lib/renderer';

  let canvas: HTMLCanvasElement | null = null;
  let renderer: RideRenderer | null = null;
  let status = 'pending';

  onMount(async () => {
    if (!canvas) return;
    const r = await attach(canvas, { testMode: true });
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

<main data-testid="webgpu-engine-smoke" data-status={status}>
  <h1>WebGPU engine smoke</h1>
  <canvas bind:this={canvas} width="320" height="240" style="width: 320px; height: 240px"></canvas>
</main>
