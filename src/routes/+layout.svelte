<!--
  The app shell (#542 P1, D1-b: SvelteKit file routes).

  Ports the React App.tsx chrome: the `.app-container` wrapper, the brand
  header (title, nav, auth) and the `.app-layout--${view}` region. The three
  screens are file routes — `/` (Row), `/search` (Routes), `/row` (workout) —
  and the active view is derived from the path, so the nav and the layout
  modifier match what App.tsx produced from `currentView`. Class names, copy
  and structure are kept verbatim so the Playwright specs keep passing; the
  per-screen content lives in each route's +page.svelte.

  Services and auth move from React context to Svelte context here (F2/F3):
  one AuthStore is created and provided, and its OAuth-callback effect runs in
  onMount. The global stylesheets are imported here so every route shares them.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { base } from '$app/paths';
  import { goto } from '$app/navigation';
  import '../index.css';
  import '../App.css';
  import { setServices } from '$lib/ui/servicesContext';
  import { setAuth } from '$lib/ui/authContext';
  import { AuthStore } from '$lib/ui/auth.svelte';
  import { setRoutesStore } from '$lib/ui/routesContext';
  import AuthButton from '$lib/ui/AuthButton.svelte';

  let { children } = $props();

  setServices();
  const auth = setAuth(new AuthStore());
  // The route catalogue is cross-screen state: the Routes screen selects a
  // route and the Row screen rows it, so it is provided once here.
  const routes = setRoutesStore();

  onMount(() => {
    // Complete an OAuth callback (?code=&state=) or restore a session.
    auth.init();
    routes.load();
  });

  // Resolve the default route and the opening selection once routes are loaded,
  // following a later sign-in or sign-out (App.tsx's preselect effect).
  $effect(() => {
    routes.syncDefaults(auth.user?.id ?? null, auth.isLoading);
  });

  // The three screens, as App.tsx's ViewMode. Derived from the route so the
  // nav active state and the `app-layout--${view}` modifier stay in sync.
  const NAV_ITEMS = [
    { view: 'routes', label: 'Row', href: `${base}/` },
    { view: 'route-search', label: 'Routes', href: `${base}/search` },
  ] as const;

  const view = $derived.by(() => {
    const path = page.url.pathname;
    if (path === `${base}/row` || path === `${base}/row/`) return 'workout';
    if (path === `${base}/search` || path === `${base}/search/`) return 'route-search';
    return 'routes';
  });

  const isWorkoutActive = $derived(view === 'workout');

  let isNavOpen = $state(false);
</script>

<svelte:head>
  <title>VirtualRow</title>
</svelte:head>

<div class="app-container">
  <header class="app-header">
    <div class="header-content">
      <h1 class="app-title">VirtualRow</h1>

      <!-- The nav stands down during a workout, as the device bar does
           (issue #219, AC8.4). -->
      {#if !isWorkoutActive}
        <button
          type="button"
          class="nav-toggle"
          aria-label="Menu"
          aria-expanded={isNavOpen}
          aria-controls="nav-overlay"
          onclick={() => (isNavOpen = !isNavOpen)}
        >
          <span></span><span></span><span></span>
        </button>
        <div class="nav-overlay" id="nav-overlay" data-open={isNavOpen}>
          <button
            type="button"
            class="nav-overlay-backdrop"
            aria-label="Close menu"
            onclick={() => (isNavOpen = false)}
          ></button>
          <nav class="app-nav" aria-label="Main">
            {#each NAV_ITEMS as item (item.view)}
              <button
                type="button"
                class="nav-tab{view === item.view ? ' active' : ''}"
                onclick={() => {
                  void goto(item.href);
                  isNavOpen = false;
                }}
              >
                {item.label}
              </button>
            {/each}
          </nav>
        </div>
      {/if}

      <div class="header-auth">
        <AuthButton />
      </div>
    </div>
    {#if !auth.isAuthenticated}
      <p class="signed-out-notice">
        You are rowing as a guest — sessions are not saved. Sign in with intervals.icu to keep
        them.
      </p>
    {/if}
  </header>

  <div class="app-layout app-layout--{view}">
    {@render children()}
  </div>
</div>
