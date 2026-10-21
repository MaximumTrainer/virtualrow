<!--
  Workout screen (#542 P1, D1-b). App.tsx's `workout` view: the rowing session
  with the live 3D scene. P1 mounts the canvas host with no engine `attach`, so
  it shows the bare `.rower3d-canvas-container` the non-3D specs assert around;
  the engine track (#550) supplies `attach` and the HUD/summary port in a later
  slice. The nav stands down for this view (handled in the layout).
-->
<script lang="ts">
  import Canvas3DHost from '$lib/ui/Canvas3DHost.svelte';
</script>

<svelte:head>
  <title>VirtualRow — Row</title>
</svelte:head>

<main class="app-main app-main--workout">
  <Canvas3DHost />
</main>
