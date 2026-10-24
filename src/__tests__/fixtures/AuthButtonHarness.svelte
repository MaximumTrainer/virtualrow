<!--
  Test fixture (#542 P1): provides a given AuthStore via the Svelte auth
  context and renders AuthButton, so a unit test can drive the button through
  real context resolution. Lives under src/__tests__ (coverage-excluded).
-->
<script lang="ts">
  import { setAuth } from '../../lib/ui/authContext';
  import type { AuthStore } from '../../lib/ui/auth.svelte';
  import AuthButton from '../../lib/ui/AuthButton.svelte';

  const props: { store: AuthStore } = $props();
  // svelte-ignore state_referenced_locally
  setAuth(props.store);
</script>

<AuthButton />
