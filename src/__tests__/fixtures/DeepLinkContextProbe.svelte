<!--
  Test fixture (#542 P1): exercises the deep-link context. With `provide`, it
  sets the given runner and reads it back through getDeepLink; without it, it
  calls getDeepLink with no provider so the throw path can be asserted. Lives
  under src/__tests__ (coverage-excluded).
-->
<script lang="ts">
  import { setDeepLink, getDeepLink } from '../../lib/ui/deepLinkContext';
  import type { RownativeDeepLinkRunner } from '../../lib/ui/deepLink.svelte';

  const props: { runner?: RownativeDeepLinkRunner; provide?: boolean } = $props();
  // svelte-ignore state_referenced_locally
  if (props.provide !== false && props.runner) setDeepLink(props.runner);
  const resolved = getDeepLink();
</script>

<div data-testid="resolved-status">{resolved.status.kind}</div>
