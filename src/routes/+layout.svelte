<script lang="ts">
  // Svelte 5 runes: the layout renders whatever route child is active.
  let { children } = $props();
</script>

{@render children()}
