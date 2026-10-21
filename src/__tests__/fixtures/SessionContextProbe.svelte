<!--
  Test fixture (#542 P1): exercises the session context. With `provide`, it sets
  the given SessionStore and reads it back through getSessionStore; without it,
  it calls getSessionStore with no provider so the throw path can be asserted.
  Lives under src/__tests__ (coverage-excluded).
-->
<script lang="ts">
  import { setSessionStore, getSessionStore } from '../../lib/ui/sessionContext';
  import type { SessionStore } from '../../lib/ui/sessionStore.svelte';

  const props: { store?: SessionStore; provide?: boolean } = $props();
  // svelte-ignore state_referenced_locally
  if (props.provide !== false && props.store) setSessionStore(props.store);
  const resolved = getSessionStore();
</script>

<div data-testid="resolved-rower">{resolved.activeRowerType}</div>
