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
  import { setSessionStore } from '$lib/ui/sessionContext';
  import { SessionStore } from '$lib/ui/sessionStore.svelte';
  import { setRideSession } from '$lib/ui/rideSessionContext';
  import { RideSessionStore } from '$lib/ui/rideSession.svelte';
  import { setDeepLink } from '$lib/ui/deepLinkContext';
  import { RownativeDeepLinkRunner } from '$lib/ui/deepLink.svelte';
  import AuthButton from '$lib/ui/AuthButton.svelte';
  import SessionSummary from '$lib/ui/SessionSummary.svelte';
  import GuestSessionSummary from '$lib/ui/GuestSessionSummary.svelte';

  let { children } = $props();

  setServices();
  const auth = setAuth(new AuthStore());
  // The route catalogue is cross-screen state: the Routes screen selects a
  // route and the Row screen rows it, so it is provided once here.
  const routes = setRoutesStore();
  // Device connection, the loaded workout and the session lifecycle outlive
  // every view switch, so the session store is provided here too — App kept its
  // BLE subscriptions alive outside the view for the same reason.
  const session = setSessionStore(new SessionStore());
  // The live rower pipeline (the latest packet, the recording session, the start
  // sequence and the finish) also outlives the view switch, so it is provided
  // here and reads the session and route stores it was handed.
  const ride = setRideSession(new RideSessionStore(session, routes, {}, auth));
  const deepLink = setDeepLink(new RownativeDeepLinkRunner());

  onMount(() => {
    // Complete an OAuth callback (?code=&state=) or restore a session.
    auth.init();
    routes.load();

    // Keep the device connection listeners alive for the lifetime of the app.
    const stopSession = session.init();
    // The rower-data and heart-rate subscriptions outlive the view switch too,
    // so a workout keeps recording after Routes → Row (App.tsx kept these
    // outside the view for exactly this reason).
    const stopRide = ride.init();

    // A session started programmatically (by workoutService, including from the
    // Row screen's Start/demo) opens the workout route; ending it returns to the
    // Row screen (App.tsx's window session bridge).
    const onStarted = (e: Event) => {
      session.onSessionStarted();
      // Seed the recording session now (App set it from the event detail) so the
      // workout view's `currentSession` guard is satisfied before the first packet.
      if (e instanceof CustomEvent) ride.onStarted(e.detail);
      void goto(`${base}/row`);
    };
    const onEnded = () => {
      session.onSessionEnded();
      void goto(`${base}/`);
    };
    window.addEventListener('virtualrow:sessionStarted', onStarted);
    window.addEventListener('virtualrow:sessionEnded', onEnded);

    return () => {
      stopSession();
      stopRide();
      window.removeEventListener('virtualrow:sessionStarted', onStarted);
      window.removeEventListener('virtualrow:sessionEnded', onEnded);
    };
  });

  // Drive the ride session from the session lifecycle. App ran the activity
  // timer and the start sequence off the same `isWorkoutActive` flag and fed the
  // demo its simulator frames while the demo was on.
  $effect(() => {
    ride.setActive(session.sessionActive);
  });
  $effect(() => {
    ride.setDemoListening(session.isDemoMode);
  });
  $effect(() => {
    ride.startSequence.setInputs({
      active: session.sessionActive,
      strokeAt: ride.strokeAt,
      autoStart: session.isDemoMode,
    });
  });

  // Resolve the default route and the opening selection once routes are loaded,
  // following a later sign-in or sign-out (App.tsx's preselect effect).
  $effect(() => {
    routes.syncDefaults(auth.user?.id ?? null, auth.isLoading);
  });

  // Import a `?rownativeCourseId=` deep link once auth has resolved, then select
  // the course and show the Row screen (App.tsx's deep-link effect, held until
  // auth is ready so a shared link survives a sign-in round trip).
  $effect(() => {
    deepLink.run(!auth.isLoading, (route) => {
      routes.routeImported(route);
      void goto(`${base}/`);
    });
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
  <!-- The post-finish summary overlays whatever screen the row ended on (App
       rendered it at the app-container root). A guest gets the guest summary;
       a signed-in athlete the full one with the upload. -->
  {#if ride.guestCompletedSession}
    <GuestSessionSummary
      session={ride.guestCompletedSession}
      onRowAgain={() => ride.guestDone()}
      onExit={() => ride.guestDone()}
      onSignIn={() => void auth.login()}
      isDemo={ride.completedSessionWasDemo}
    />
  {/if}

  {#if ride.completedSession}
    <SessionSummary
      session={ride.completedSession}
      onDone={() => ride.sessionDone()}
      onSaved={(id) => ride.sessionSaved(id)}
      isDemo={ride.completedSessionWasDemo}
      personalBest={ride.completedSessionBest}
      ghost={ride.completedGhost}
      routeGeometrySource={routes.selectedRoute?.geometrySource}
    />
  {/if}

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
