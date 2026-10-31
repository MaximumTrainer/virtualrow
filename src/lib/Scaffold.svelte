<script lang="ts">
  // #542 P0 smoke component: the first Svelte component on the branch, here to
  // prove `@testing-library/svelte` compiles and renders under Vitest (AC3).
  // P1 replaces it with the ported screens.
  let { name }: { name: string } = $props();
</script>

<p>Hello {name}</p>
