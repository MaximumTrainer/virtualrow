<!--
  Test fixture (#542 P1): provides a stub services bundle via the Svelte
  services context and renders RownativeRouteImport, so a unit test drives the
  component through real context resolution. Lives under src/__tests__
  (coverage-excluded).
-->
<script lang="ts">
  import { setServices } from '../../lib/ui/servicesContext';
  import type { Services } from '../../lib/ports';
  import type { WaterRoute } from '../../lib/types/index';
  import RownativeRouteImport from '../../lib/ui/RownativeRouteImport.svelte';

  const props: {
    overrides: Partial<Services>;
    onRouteImported: (route: WaterRoute) => void;
  } = $props();

  // svelte-ignore state_referenced_locally
  setServices(props.overrides);
</script>

<RownativeRouteImport onRouteImported={props.onRouteImported} />
