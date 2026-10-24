<!--
  Test fixture (#542 P1): exercises the routes context. With `provide`, it sets
  the given RoutesStore and reads it back through getRoutesStore; without it, it
  calls getRoutesStore with no provider so the throw path can be asserted. Lives
  under src/__tests__ (coverage-excluded).
-->
<script lang="ts">
  import { setRoutesStore, getRoutesStore } from '../../lib/ui/routesContext';
  import type { RoutesStore } from '../../lib/ui/routesStore.svelte';

  const props: { store?: RoutesStore; provide?: boolean } = $props();
  // svelte-ignore state_referenced_locally
  if (props.provide !== false && props.store) setRoutesStore(props.store);
  const resolved = getRoutesStore();
</script>

<div data-testid="resolved-filter">{resolved.difficultyFilter}</div>
