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
  import { attach } from '$lib/renderer/engine/attach';
  import { toEngineRoute } from '$lib/ui/sceneryRoute';
  import { describeLoadProgress, LOAD_PHASES } from '$lib/utils/loadingProgress';
  import { getSessionStore } from '$lib/ui/sessionContext';
  import { getRideSession } from '$lib/ui/rideSessionContext';
  import { getRoutesStore } from '$lib/ui/routesContext';
  import { FullscreenStore } from '$lib/ui/fullscreen.svelte';
  import Canvas3DHost from '$lib/ui/Canvas3DHost.svelte';
  import RouteLoadingBar from '$lib/ui/RouteLoadingBar.svelte';
  import WorkoutBlockPanel from '$lib/ui/WorkoutBlockPanel.svelte';
  import RouteMap from '$lib/ui/RouteMap.svelte';
  import StartCallout from '$lib/ui/StartCallout.svelte';
  import FinishBanner from '$lib/ui/FinishBanner.svelte';
  import RowHud from '$lib/ui/RowHud.svelte';

  const session = getSessionStore();
  const ride = getRideSession();
  const routes = getRoutesStore();

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

  // The engine reads a `SceneryRoute` (curvePoints + totalDistanceMeters) to
  // run the boat along; the shell's `WaterRoute` carries neither, so adapt it
  // (#570 AC2). Re-derives when the rower picks a different route.
  const engineRoute = $derived(toEngineRoute(routes.selectedRoute));
</script>

<svelte:head>
  <title>VirtualRow — Row</title>
</svelte:head>

<main class="app-main">
  {#if session.sessionActive && ride.currentSession}
    <div class="view-container activity-view{fullscreen.active && !fullscreen.supported ? ' activity-view--fullscreen' : ''}">
      <div class="activity-screen">
        <div class="activity-route-stage" bind:this={stageEl}>
          <RouteLoadingBar progress={routeLoadProgress} />

          <Canvas3DHost {attach} route={engineRoute} {testMode} getFrame={() => ride.frame()} />

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
         the `.rower3d-canvas-container` the non-3D specs assert around. -->
    <Canvas3DHost />
  {/if}
</main>
