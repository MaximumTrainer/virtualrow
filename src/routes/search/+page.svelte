<!--
  Routes screen (#542 P1, D1-b). App.tsx's `route-search` view: the map-primary
  route browser (map, drawer, pins, clustering, detail overlay — #505). The
  layout region matches what App.tsx produced for `currentView ===
  'route-search'`; the MapLibre content is ported in a later slice. Class names
  are kept verbatim so the Playwright selectors keep resolving.
-->
<svelte:head>
  <title>VirtualRow — Routes</title>
</svelte:head>

<aside class="app-sidebar">
  <!-- The route drawer lands here in a later P1 slice. -->
</aside>
<main class="app-main">
  <!-- The route map lands here in a later P1 slice. -->
</main>
