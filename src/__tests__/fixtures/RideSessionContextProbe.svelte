<!--
  Test fixture (#542 workout slice): exercises the ride-session context. With
  `provide`, it sets the given RideSessionStore and reads it back through
  getRideSession; without it, it calls getRideSession with no provider so the
  throw path can be asserted. Lives under src/__tests__ (coverage-excluded).
-->
<script lang="ts">
  import { setRideSession, getRideSession } from '../../lib/ui/rideSessionContext';
  import type { RideSessionStore } from '../../lib/ui/rideSession.svelte';

  const props: { store?: RideSessionStore; provide?: boolean } = $props();
  // svelte-ignore state_referenced_locally
  if (props.provide !== false && props.store) setRideSession(props.store);
  const resolved = getRideSession();
</script>

<div data-testid="resolved-elapsed">{resolved.activityElapsedMs}</div>
