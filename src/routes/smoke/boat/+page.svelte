<!--
  #570 P7 engine smoke page (D7-smoke of #570). Mounts the WebGPU engine on
  a bare canvas with a stub `getFrame` so the Playwright smoke spec can
  assert `__ROWER3D_POS.progress`, `__ROWER3D_BOAT`, `__ROWER3D_CREW` and
  `__ROWER3D_GHOST_METERS` without needing the full Row screen.
-->
<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { attach, type RideFrame, type RideRenderer } from '../../../lib/renderer';
  import { paceGhost } from '../../../components/rower3d/ghost';

  let canvas: HTMLCanvasElement | null = null;
  let renderer: RideRenderer | null = null;
  let status = 'pending';

  const ghost = paceGhost(130); // 130 s / 500 m — ≈ 3.85 m/s

  // Stub RideFrame. Advances `distanceMeters` + `elapsedSeconds` so the
  // boat moves along the smoke route and the crew visibly rows.
  const start = Date.now();
  const stub = (): RideFrame => {
    const elapsed = (Date.now() - start) / 1000;
    const distance = 2.5 * elapsed;
    return {
      paceSPer500: 130,
      distanceMeters: distance,
      cadence: 28,
      isPlaying: true,
      holdBoat: elapsed < 0.5,
      finished: false,
      intensityFactor: 1,
      elapsedSeconds: elapsed,
      ghost,
    };
  };

  onMount(async () => {
    if (!canvas) return;
    const r = await attach(canvas, { testMode: true, getFrame: stub });
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

<main data-testid="webgpu-boat-smoke" data-status={status}>
  <h1>WebGPU boat smoke</h1>
  <canvas bind:this={canvas} width="320" height="240" style="width: 320px; height: 240px"></canvas>
</main>
