<!--
  Row screen (#542 P1, D1-b). App.tsx's `routes` view: one route, its map, and
  the two ways to start it — connect a device and start a workout, or try a demo
  row. Finding a different route lives on the Routes screen (#219 R2).

  The sidebar holds the device panels (rower + heart-rate); the main panel shows
  the selected route's map and details with the ghost / conditions / sound /
  crew / appearance pickers and the start controls. Device connection, the
  loaded workout and the ghost choice are cross-view, so they come from the
  shared SessionStore; the per-row picker state (conditions / crew / appearance)
  is page-local and persisted to localStorage. Class names, data-testids and
  copy are kept verbatim so the Row Playwright specs keep passing. Starting a
  session navigates to the workout route via the shell's session bridge.
-->
<script lang="ts">
  import { base } from '$app/paths';
  import { goto } from '$app/navigation';
  import {
    externalDistanceNote,
    formatRouteDistanceKm,
    geometryProvenanceBadge,
  } from '$lib/utils/geometryProvenance';
  import { loadSessions } from '$lib/services/localStorageWorkoutStore';
  import { bestRowOnRoute } from '../components/rower3d/ghost';
  import { getAuth } from '$lib/ui/authContext';
  import { getServices } from '$lib/ui/servicesContext';
  import { getRoutesStore } from '$lib/ui/routesContext';
  import { getSessionStore } from '$lib/ui/sessionContext';
  import { getDeepLink } from '$lib/ui/deepLinkContext';
  import { routeGeometrySource } from '$lib/ui/routesStore.svelte';
  import { ConditionsStore } from '$lib/ui/useConditions.svelte';
  import { CrewPreferenceStore } from '$lib/ui/useCrewPreference.svelte';
  import { RowerAppearanceStore } from '$lib/ui/useRowerAppearance.svelte';
  import { debugPreferencesStore } from '$lib/services/debugPreferencesStore';
  import BluetoothDevice from '$lib/ui/BluetoothDevice.svelte';
  import FTMSDevice from '$lib/ui/FTMSDevice.svelte';
  import HeartRateMonitor from '$lib/ui/HeartRateMonitor.svelte';
  import RouteMap from '$lib/ui/RouteMap.svelte';
  import GhostPicker from '$lib/ui/GhostPicker.svelte';
  import ConditionsPicker from '$lib/ui/ConditionsPicker.svelte';
  import SoundPicker from '$lib/ui/SoundPicker.svelte';
  import CrewPicker from '$lib/ui/CrewPicker.svelte';
  import RowerAppearancePicker from '$lib/ui/RowerAppearancePicker.svelte';
  import LoadTodaysWorkoutButton from '$lib/ui/LoadTodaysWorkoutButton.svelte';
  import { decideAutoSeedAction } from '$lib/ui/demoWorkoutAutoSeed.svelte';

  const auth = getAuth();
  const services = getServices();
  const routes = getRoutesStore();
  const session = getSessionStore();
  const deepLink = getDeepLink();

  // #472 FR3 + FR6: a guest on the demo route gets the bundled placeholder
  // workout seeded; a sign-in while the placeholder is active clears it. The
  // decision is in a pure function so every negative case is tested without a
  // Svelte $effect harness; this effect is the thin wiring.
  let demoSeeded = $state(false);
  $effect(() => {
    const action = decideAutoSeedAction({
      activeRouteId: routes.selectedRoute?.id ?? null,
      isAuthenticated: auth.isAuthenticated,
      currentWorkout: session.currentWorkout.current,
      seeded: demoSeeded,
    });
    if (action.kind === 'seed') {
      session.currentWorkout.set(services.demoWorkoutService.getDemoWorkout());
      demoSeeded = true;
    } else if (action.kind === 'clear') {
      session.currentWorkout.set(null);
      demoSeeded = false;
    }
  });

  // Per-row mood controls (#346 / #443 / #474): local to this screen and
  // persisted, so they survive a navigation without being session state.
  const conditions = new ConditionsStore();
  const crew = new CrewPreferenceStore();
  const rowerAppearance = new RowerAppearanceStore();

  const testMode = typeof window !== 'undefined' && !!window.__PLAYWRIGHT_TESTING;
  // Guests are not recorded as a real workout (App.tsx line 138).
  const isGuestSession = $derived(!auth.isAuthenticated && !testMode);

  // The demo CTA is for guests (#219 AC7.2) and for Playwright; signed-in
  // athletes only see it via the debug-panel override (#453 FR1/FR3).
  const showDemoCtaOverride = debugPreferencesStore.getShowDemoCtaOverride();
  const demoCtaVisible = $derived(
    !auth.isAuthenticated || !auth.user || testMode || showDemoCtaOverride,
  );

  /** The quickest row this browser kept on the selected route, if any (#338). */
  const bestRowHere = $derived.by(() => {
    const user = auth.user;
    const route = routes.selectedRoute;
    if (!user || !route) return null;
    return bestRowOnRoute(loadSessions(user.id), route.id);
  });
</script>

<aside class="app-sidebar">
  <div class="routes-devices-row">
    <div class="device-panel device-panel--selection">
      <div class="device-panel-heading">
        <h3 class="panel-title">Rower Device</h3>
        <span
          class="device-panel-status {session.selectedRowerConnected ? 'connected' : 'disconnected'}"
        >
          {session.selectedRowerConnected ? 'Connected' : 'Not connected'}
        </span>
      </div>
      <div class="device-selector-tabs" role="tablist" aria-label="Rower type">
        <button
          class="device-selector-tab {session.activeRowerType === 'pm5' ? 'active' : ''}"
          onclick={() => session.setActiveRowerType('pm5')}
          type="button"
        >
          PM5
        </button>
        <button
          class="device-selector-tab {session.activeRowerType === 'ftms' ? 'active' : ''}"
          onclick={() => session.setActiveRowerType('ftms')}
          type="button"
        >
          FTMS
        </button>
      </div>
      {#if session.activeRowerType === 'pm5'}
        <BluetoothDevice />
      {:else}
        <FTMSDevice />
      {/if}
    </div>
    <div class="device-panel">
      <HeartRateMonitor
        onConnected={() => session.setHrConnected(true)}
        onDisconnected={() => session.setHrConnected(false)}
      />
    </div>
  </div>
</aside>

<main class="app-main">
  {#if routes.selectedRoute}
    {@const route = routes.selectedRoute}
    {@const badge = geometryProvenanceBadge(routeGeometrySource(route))}
    {@const extNote = externalDistanceNote(route)}
    <div class="view-container view-container--routes">
      <div class="map-container">
        <RouteMap {route} />
      </div>
      <div class="route-details-panel">
        {#if deepLink.status.kind !== 'idle' && deepLink.status.kind !== 'loaded'}
          <div
            class="rownative-handoff-banner rownative-handoff-banner--{deepLink.status.kind}"
            role={deepLink.status.kind === 'error' ? 'alert' : 'status'}
          >
            {deepLink.status.kind === 'loading'
              ? `Loading rownative course ${deepLink.status.courseId}...`
              : deepLink.status.message}
            {#if deepLink.status.kind === 'error'}
              <button
                type="button"
                class="rownative-handoff-dismiss"
                onclick={() => deepLink.dismiss()}
              >
                Dismiss
              </button>
            {/if}
          </div>
        {/if}

        <div class="route-info-overlay">
          <div class="route-info-header">
            <h2>{route.name}</h2>
            <p class="route-location">📍 {route.location}</p>
          </div>

          <div class="route-meta-compact">
            <span class="meta-badge">
              📏 {formatRouteDistanceKm(route.distance)}
            </span>
            {#if extNote}
              <span
                class="meta-badge meta-badge--external-distance"
                title="rownative measures a course as straight lines between its gates, so it reads short on a course that bends."
              >
                {extNote}
              </span>
            {/if}
            <span class="meta-badge">
              ⏱️ {route.estimatedTime} min
            </span>
            <span class="meta-badge badge-{route.difficulty}">
              {route.difficulty}
            </span>
            {#if badge}
              <span class="meta-badge meta-badge--{badge.modifier}" title={badge.title}>
                {badge.label}
              </span>
            {/if}
          </div>

          {#if routes.selectedRouteEnrichmentLoading}
            <p class="route-enrichment-status">Loading route data…</p>
          {/if}

          <!-- Decided before the row, not during it (#338). -->
          <GhostPicker
            value={session.ghostChoice}
            onChange={(choice) => (session.ghostChoice = choice)}
            hasBest={bestRowHere !== null}
            bestPace={bestRowHere?.averagePace ?? null}
          />

          <!-- Signed-in athletes can load today's planned session from
               intervals.icu, or search a nearby day (#445). Guests get neither. -->
          {#if auth.user && services.authService.getAccessToken()}
            <LoadTodaysWorkoutButton
              authService={services.authService}
              intervalsIcuWorkoutService={services.intervalsIcuWorkoutService}
              athleteId={auth.user.id}
              onLoad={(workout) => session.currentWorkout.set(workout)}
            />
          {/if}

          {#if session.currentWorkout.current}
            <p class="loaded-workout-name" data-testid="loaded-workout-name">
              Loaded: {session.currentWorkout.current.name}
            </p>
          {/if}

          <button
            class="btn btn-start-workout"
            onclick={() => session.startWorkout(routes.selectedRoute, isGuestSession)}
            disabled={!session.selectedRowerConnected || !session.hrConnected}
          >
            {#if session.selectedRowerConnected && session.hrConnected}
              ▶ Start Workout
            {:else if !session.selectedRowerConnected}
              ⚠ Connect {session.activeRowerLabel} First
            {:else}
              ⚠ Connect HR Monitor First
            {/if}
          </button>

          <!-- The single door to route discovery (#219 AC2.2). -->
          <button
            class="btn btn-change-route"
            type="button"
            onclick={() => goto(`${base}/search`)}
          >
            Change route
          </button>

          <!-- Offered to guests always (#219 AC7.2) and to signed-in athletes
               only via the debug-panel override (#453 FR1/FR3/FR7). -->
          {#if demoCtaVisible}
            <div class="demo-row-cta">
              <button
                class="btn btn-try-demo"
                onclick={() => session.startDemo(routes.selectedRoute, isGuestSession, demoCtaVisible)}
                type="button"
              >
                ▶ Try a demo row — no rowing machine needed
              </button>
              <p class="demo-row-note">
                Rows this route on simulated rower and heart-rate data, so you can see how it
                feels before connecting anything.
              </p>
            </div>
          {/if}

          <!-- The Graphics picker moved to the debug panel (#454 Phase 1). #346's
               ConditionsPicker is a per-row mood control, so it stays here. -->
          <ConditionsPicker
            choice={conditions.choice}
            resolved={conditions.conditions}
            onChange={(choice) => conditions.setChoice(choice)}
          />

          <SoundPicker
            enabled={session.soundEnabled}
            volume={session.soundVolume}
            onToggle={(enabled) => session.setSoundEnabled(enabled)}
            onVolume={(volume) => session.setSoundVolume(volume)}
          />

          <!-- Signed-in athletes whose intervals.icu profile carries a sex read
               the rower from that profile; the picker is for guests, demo rows
               and profiles without the field (#443, keeps #232's fix). -->
          {#if !auth.user?.gender}
            <CrewPicker
              preference={crew.preference}
              onChange={(preference) => crew.setPreference(preference)}
            />
          {:else}
            <p class="crew-profile-hint" data-testid="crew-profile-hint">
              Rower matches your intervals.icu profile ·{' '}
              <a href="https://intervals.icu/settings" target="_blank" rel="noopener noreferrer">
                Update on intervals.icu ↗
              </a>
            </p>
          {/if}

          <!-- Clothing / hair colour picker (#474). intervals.icu does not carry
               clothing, so it is visible to everyone. -->
          <RowerAppearancePicker
            appearance={rowerAppearance.appearance}
            onChange={rowerAppearance.setSlot.bind(rowerAppearance)}
          />
        </div>
      </div>
    </div>
  {/if}
</main>
