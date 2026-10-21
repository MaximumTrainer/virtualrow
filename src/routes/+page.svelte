<!--
  Row screen (#542 P1, D1-b). This is App.tsx's `routes` view: the landing
  where a device is picked and a session is started. The layout region
  (`.app-sidebar` + `.app-main`) matches what App.tsx rendered for
  `currentView === 'routes'`; the per-panel content (device pickers, route
  list) is ported in a later slice. Class names are kept verbatim so the
  Playwright selectors keep resolving.
-->
<svelte:head>
  <title>VirtualRow</title>
</svelte:head>

<aside class="app-sidebar">
  <!-- Device panels and the route list land here in a later P1 slice. -->
</aside>
<main class="app-main">
  <!-- The Row landing content (session controls) lands here in a later P1
       slice; the 3D view lives on the /row route. -->
</main>
