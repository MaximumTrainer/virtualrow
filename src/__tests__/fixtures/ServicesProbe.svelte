<!--
  Test fixture for the Svelte services context (#542 P1). Calls setServices
  (unless `skipSet`) and reports the bundle getServices resolves, so a unit
  test can assert the provide/resolve and the no-provider fallback. Lives under
  src/__tests__, which coverage excludes. Reads props off the `$props()` object
  once at init (not reactive destructuring) — a one-shot snapshot is the intent.
-->
<script lang="ts">
  import type { Services } from '../../lib/ports';
  import { setServices, getServices } from '../../lib/ui/servicesContext';

  const props: {
    overrides?: Partial<Services>;
    skipSet?: boolean;
    report: (services: Services) => void;
  } = $props();

  // A one-shot snapshot at init is exactly the intent here.
  // svelte-ignore state_referenced_locally
  if (!props.skipSet) setServices(props.overrides);
  // svelte-ignore state_referenced_locally
  props.report(getServices());
</script>
