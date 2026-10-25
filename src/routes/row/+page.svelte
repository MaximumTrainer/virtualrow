<!--
  Workout screen (#542 P1) — App.tsx's `workout` view ported to Svelte.

  The live rowing session: the 3D stage (the engine draws into `Canvas3DHost`'s
  canvas, fed the per-frame row state through the `getFrame` seam), the route
  loading bar, the structured-workout block panel, the route summary and map
  overlay, the start/finish callouts, and the HUD. Device connection, the
  recording session, the start sequence and the finish live on the shell's
  SessionStore / RideSessionStore, provided in `+layout.svelte`, so a session
  keeps recording across the Routes → Row navigation.

  DOM, class names, data-testids and copy match App.tsx so the Playwright
  workout specs keep resolving (AC2). The session summary that opens after the
  finish lands with the next slice.
-->
<script lang="ts">
  import { base } from '$app/paths';
  import { attach } from '$lib/renderer/engine/attach';
  import { toEngineRoute } from '$lib/ui/sceneryRoute';
  import { describeLoadProgress, LOAD_PHASES } from '$lib/utils/loadingProgress';
  import { getSessionStore } from '$lib/ui/sessionContext';
  import { getRideSession } from '$lib/ui/rideSessionContext';
  import { getRoutesStore } from '$lib/ui/routesContext';
  import { getAuth } from '$lib/ui/authContext';
  import { CrewPreferenceStore } from '$lib/ui/useCrewPreference.svelte';
  import { resolveCrew, effectiveCrewPreference } from '../../components/rower3d/crewModel';
  import { FullscreenStore } from '$lib/ui/fullscreen.svelte';
  import Canvas3DHost, { type CanvasBackend } from '$lib/ui/Canvas3DHost.svelte';
  import RouteLoadingBar from '$lib/ui/RouteLoadingBar.svelte';
  import WorkoutBlockPanel from '$lib/ui/WorkoutBlockPanel.svelte';
  import RouteMap from '$lib/ui/RouteMap.svelte';
  import StartCallout from '$lib/ui/StartCallout.svelte';
  import FinishBanner from '$lib/ui/FinishBanner.svelte';
  import RowHud from '$lib/ui/RowHud.svelte';
  import WebGpuUnsupported from '$lib/ui/WebGpuUnsupported.svelte';

  const session = getSessionStore();
  const ride = getRideSession();
  const routes = getRoutesStore();
  const auth = getAuth();
  const crewPreference = new CrewPreferenceStore();

  const testMode = typeof window !== 'undefined' && !!window.__PLAYWRIGHT_TESTING;

  // The load bar watched the three/R3F scene load in App; the WebGPU engine owns
  // its own load now, so until it reports phases the bar is complete (and so
  // renders nothing). Real phases land with the engine's load telemetry.
  const routeLoadProgress = describeLoadProgress(new Set(LOAD_PHASES.map((p) => p.key)));

  // Put the stage on the whole screen (#335). The control reads its element back
  // from the browser's own fullscreenchange, so hand it the stage once mounted.
  const fullscreen = new FullscreenStore();
  let stageEl = $state<HTMLDivElement | undefined>(undefined);
  $effect(() => fullscreen.bind(stageEl ?? null));

  const workout = $derived(session.currentWorkout);

  // The engine reads a `SceneryRoute` (curvePoints + totalDistanceMeters + loop
  // flag + per-progress shore widths) to run the boat along and build the
  // water strip. Shell's `WaterRoute` carries none of this, so adapt it, and
  // pass whatever enrichment the routes store already has cached so the water
  // bends with the OSM-measured river (#570 AC2 + #549 scenery slice).
  const selectedEnrichment = $derived(
    routes.selectedRoute ? routes.routeEnrichments[routes.selectedRoute.id] ?? null : null,
  );
  const engineRoute = $derived(toEngineRoute(routes.selectedRoute, selectedEnrichment));

  // #542 AC11: when the engine declines (no WebGPU, software adapter, attach
  // throw) the ride view swaps the stage for the "needs WebGPU" screen; the
  // rest of the site stays reachable through the Routes link.
  let canvasBackend = $state<CanvasBackend>('stub');

  // Crewed-scull selection (#232 / #443): a signed-in profile with a `sex`
  // field wins, otherwise the stored CrewPreference decides, otherwise male.
  // The engine stays free of this policy — it just loads the GLB url the
  // shell resolves. See `src/components/rower3d/crewModel.ts` for the rules.
  const resolvedCrew = $derived(
    resolveCrew(
      auth.user?.gender ?? null,
      effectiveCrewPreference(auth.user?.gender ?? null, crewPreference.preference),
    ),
  );
</script>

<svelte:head>
  <title>VirtualRow — Row</title>
</svelte:head>

<main class="app-main">
  {#if session.sessionActive && ride.currentSession}
    <div class="view-container activity-view{fullscreen.active && !fullscreen.supported ? ' activity-view--fullscreen' : ''}">
      <div class="activity-screen">
        <div class="activity-route-stage" bind:this={stageEl}>
          <!-- #542 AC11: when the engine declines (no WebGPU, software adapter,
               attach throw) we show the "needs WebGPU" screen as an overlay.
               The stage below stays mounted so specs that assert around
               `.rower3d-canvas-container` (crash-detection, crash-telemetry,
               etc.) still find it, while the overlay carries the user-facing
               message and the back link. -->
          {#if canvasBackend === 'unavailable'}
            <div class="activity-webgpu-unsupported-overlay">
              <WebGpuUnsupported backHref={base + '/'} />
            </div>
          {/if}

          <RouteLoadingBar progress={routeLoadProgress} />

          <Canvas3DHost
            {attach}
            route={engineRoute}
            {testMode}
            getFrame={() => ride.frame()}
            crew={resolvedCrew}
            onBackend={(b) => (canvasBackend = b)}
          />

          {#if workout.current && workout.progress}
            <WorkoutBlockPanel
              workout={workout.current}
              segments={workout.segments}
              progress={workout.progress}
              currentPaceSecondsPer500={ride.pm5Data?.pace ?? null}
              currentPowerWatts={ride.pm5Data?.power ?? null}
              deviceConnected={session.selectedRowerConnected}
            />
          {/if}

          <div class="activity-route-summary">
            <h2>{routes.selectedRoute?.name}</h2>
            <p>{routes.selectedRoute?.location}</p>
            {#if session.isDemoMode}
              <p class="activity-demo-badge" role="status">
                Demo row — simulated data, not a recorded workout
              </p>
            {/if}
          </div>

          <div class="activity-map-overlay">
            {#if routes.selectedRoute}
              <RouteMap
                route={routes.selectedRoute}
                highlightMode={true}
                progressPercent={ride.activityProgressPercent}
              />
            {/if}
          </div>

          {#if ride.finish}
            <FinishBanner distanceMeters={ride.finish.distanceMeters} elapsedMs={ride.finish.elapsedMs} />
          {:else}
            <StartCallout phase={ride.startSequence.phase} countdown={ride.startSequence.countdown} />
          {/if}

          <RowHud
            paceSecondsPer500={ride.pm5Data?.pace ?? null}
            strokeRate={ride.pm5Data?.cadence ?? null}
            power={ride.pm5Data?.power ?? null}
            heartRate={ride.latestHeartRate}
            distanceMeters={ride.currentSession.distance}
            elapsedMs={ride.workoutElapsedTimeMs}
            paused={session.sessionState === 'paused'}
            onPause={() => ride.pauseWorkout()}
            onResume={() => ride.resumeWorkout()}
            onReset={() => ride.resetWorkout()}
            onEnd={() => ride.endWorkout()}
            {fullscreen}
            ghost={ride.ghostGap}
          />
        </div>
      </div>
    </div>
  {:else}
    <!-- No active session: the bare canvas host, so a direct visit still shows
         the `.rower3d-canvas-container` the non-3D specs assert around.
         We deliberately omit `attach` here — a direct visit without a session
         should not kick the engine or probe WebGPU; AC11's screen fires only
         once a ride would actually need to render. -->
    <Canvas3DHost />
  {/if}
</main>

<style>
  /* The "needs WebGPU" screen sits on top of the stage so the specs that
     assert around `.rower3d-canvas-container` still find it, and the
     user still sees the message plus the back link above everything. */
  .activity-webgpu-unsupported-overlay {
    position: absolute;
    inset: 0;
    z-index: 50;
    display: flex;
  }

  .activity-webgpu-unsupported-overlay :global(.webgpu-unsupported) {
    flex: 1;
  }
</style>
