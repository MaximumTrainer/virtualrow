<svelte:head>
  <title>virtualrow</title>
</svelte:head>

<!--
  #542 P0 placeholder. P1 ports the real screens (demo, routes, activity) onto
  this route tree, reusing the existing CSS and class names verbatim so the
  Playwright suite keeps acting as the harness. For now this is just proof the
  SvelteKit app builds and serves at the deploy base path.
-->
<main data-testid="svelte-scaffold">
  <h1>virtualrow</h1>
  <p>SvelteKit + WebGPU rebuild — scaffold.</p>
</main>
