<!--
  Canvas3DHost — the ride-canvas seam host (#542 P1 / D10-c).

  Renders `.rower3d-canvas-container` and the `<canvas>` the engine draws into,
  and owns the lifecycle at the boundary between the UI-shell track (this
  component) and the engine track (`src/lib/renderer/`). Pass the engine's
  `attach` entrypoint as the `attach` prop and the host mounts it against the
  canvas; omit it and the host shows a bare canvas (no renderer, no three),
  which is what P1 ships until the engine lands (#550 D6-a). The engine never
  edits this file — it implements `attach` in its own package and the ride view
  passes it in.

  The DOM mirrors the React `Rower3D` container: the `.rower3d-fallback-marker`
  and `.rower3d-gpu-backend` markers and the camera-view control are kept so
  the non-3D specs that assert around the canvas keep passing.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import type { RideAttach, RideRenderer } from './rideCanvas';

  interface Props {
    /** The engine's `attach` entrypoint. Omitted in P1 → bare canvas. */
    attach?: RideAttach;
    /** Resolved performance tier, passed through to the engine. */
    tier?: string;
    /** The selected route the ride draws, passed through to the engine. */
    route?: unknown;
    /** True under Playwright. */
    testMode?: boolean;
  }

  let { attach, tier, route, testMode = false }: Props = $props();

  let container = $state<HTMLDivElement | undefined>(undefined);
  let canvas = $state<HTMLCanvasElement | undefined>(undefined);
  // 'stub' until the engine attaches; 'live' once it does; 'unavailable' if the
  // engine declined (returned null).
  let backend = $state<'stub' | 'live' | 'unavailable'>('stub');

  onMount(() => {
    if (!attach || !canvas) return;
    let handle: RideRenderer | null = null;
    let disposed = false;
    Promise.resolve(attach(canvas, { tier, route, testMode }))
      .then((r) => {
        if (disposed) {
          r?.dispose();
          return;
        }
        handle = r;
        backend = r ? 'live' : 'unavailable';
      })
      .catch(() => {
        backend = 'unavailable';
      });
    return () => {
      disposed = true;
      handle?.dispose();
    };
  });
</script>

<div class="rower3d-canvas-container" bind:this={container}>
  <!-- Hidden markers: the specs read these without them being visible. -->
  <div class="rower3d-fallback-marker" data-loaded="true" style="display: none;"></div>
  <div class="rower3d-gpu-backend" data-backend={backend} style="display: none;"></div>

  <canvas class="rower3d-canvas" bind:this={canvas}></canvas>

  {#if backend !== 'live'}
    <!-- P1 stub: the engine track replaces this with real frames. Kept out of
         the way of the UI chrome the specs assert on. -->
    <div class="rower3d-stub-placeholder" aria-hidden="true">
      {backend === 'unavailable' ? '3D view unavailable' : ''}
    </div>
  {/if}
</div>
