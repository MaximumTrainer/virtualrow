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
  import { resolvePerformanceMode } from '../../components/rower3d/constants';
  import { getGraphicsStore } from '$lib/ui/graphicsContext';
  import { toEngineRoute } from '$lib/ui/sceneryRoute';
  import { describeLoadProgress, LOAD_PHASES } from '$lib/utils/loadingProgress';
  import { getSessionStore } from '$lib/ui/sessionContext';
  import { getRideSession } from '$lib/ui/rideSessionContext';
  import { getRoutesStore } from '$lib/ui/routesContext';
  import { getAuth } from '$lib/ui/authContext';
  import { CrewPreferenceStore } from '$lib/ui/useCrewPreference.svelte';
  import { resolveCrew, effectiveCrewPreference } from '../../components/rower3d/crewModel';
  import { FullscreenStore } from '$lib/ui/fullscreen.svelte';
  import { CameraViewStore } from '$lib/ui/cameraView.svelte';
  import Canvas3DHost, { type CanvasBackend } from '$lib/ui/Canvas3DHost.svelte';
  import RouteLoadingBar from '$lib/ui/RouteLoadingBar.svelte';
  import WorkoutBlockPanel from '$lib/ui/WorkoutBlockPanel.svelte';
  import { DEMO_WORKOUT_ID } from '$lib/data/demoWorkout';
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

  // Camera view, cycled on V (#328). The store owns persistence; the page owns
  // the window listener so it leaves with the ride view.
  const cameraView = new CameraViewStore();
  $effect(() => cameraView.bindKeyboard());

  const workout = $derived(session.currentWorkout);

  // The engine reads a `SceneryRoute` (curvePoints + totalDistanceMeters + loop
  // flag + per-progress shore widths) to run the boat along and build the
  // water strip. Shell's `WaterRoute` carries none of this, so adapt it, and
  // pass whatever enrichment the routes store already has cached so the water
  // bends with the OSM-measured river (#570 AC2 + #549 scenery slice).
  const selectedEnrichment = $derived(
    routes.selectedRoute ? routes.routeEnrichments[routes.selectedRoute.id] ?? null : null,
  );
  // #591-fu P2c: two-axis quality. Each axis prefers the user's explicit
  // choice from the GraphicsQualityStore when they've moved either slider
  // off 'auto'; otherwise falls back to the device-probed tier
  // (`resolvePerformanceMode()`), which honours `__VIRTUALROW_PERFORMANCE_MODE`
  // and the Playwright flag. The scenery builder sees ONE tier (quality) —
  // it governs kit trees, placement budget, palette gates — and the engine
  // sees BOTH (quality + distance) so sprout window / fog look-ahead can be
  // scaled independently.
  const graphics = getGraphicsStore();
  const resolvedTier = $derived.by(() => {
    if (typeof window === 'undefined') return undefined;
    return graphics?.performanceMode ?? resolvePerformanceMode();
  });
  const resolvedDistance = $derived.by(() => {
    if (typeof window === 'undefined') return undefined;
    return graphics?.distanceMode ?? resolvedTier;
  });
  const engineRoute = $derived(toEngineRoute(routes.selectedRoute, selectedEnrichment, resolvedTier));

  // #542 AC11: when the engine declines (no WebGPU, software adapter, attach
  // throw) the ride view swaps the stage for the "needs WebGPU" screen; the
  // rest of the site stays reachable through the Routes link.
  let canvasBackend = $state<CanvasBackend>('stub');

  // #584 FR1 — on a device loss the engine publishes a user-facing banner on
  // `window.__ROWER3D_BANNER`. We poll it at 250 ms so a reader sees the
  // "restoring" state as soon as it lands, without the engine having to
  // reach into Svelte state. The copy itself lives in attach.ts (D2-a).
  let banner = $state<{ visible: boolean; message: string; variant: string }>({
    visible: false,
    message: '',
    variant: '',
  });
  $effect(() => {
    if (typeof window === 'undefined') return;
    const read = (): void => {
      const b = (window as unknown as {
        __ROWER3D_BANNER?: { visible: boolean; message: string; variant: string };
      }).__ROWER3D_BANNER;
      if (!b) return;
      if (
        b.visible !== banner.visible ||
        b.message !== banner.message ||
        b.variant !== banner.variant
      ) {
        banner = { visible: b.visible, message: b.message, variant: b.variant };
      }
    };
    read();
    const id = window.setInterval(read, 250);
    return () => window.clearInterval(id);
  });

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

          <!-- #584 FR1 — device-lost banner. Shows "restoring…" while the
               engine attempts a reattach on the same canvas, and
               "couldn't get it back" if the retry's device also dies.
               The rower keeps rowing underneath; the row stays recorded
               because the session is DOM-driven, not render-driven. -->
          {#if banner.visible}
            <div
              class="activity-device-lost-banner activity-device-lost-banner--{banner.variant}"
              role="status"
              aria-live="polite"
            >
              {banner.message}
            </div>
          {/if}

          <RouteLoadingBar progress={routeLoadProgress} />

          <Canvas3DHost
            {attach}
            tier={resolvedTier}
            distanceTier={resolvedDistance}
            route={engineRoute}
            {testMode}
            getFrame={() => ({ ...ride.frame(), view: cameraView.view })}
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
              isDemo={workout.current.id === DEMO_WORKOUT_ID}
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

  /* #584 FR1 — device-lost banner. Sits above the (frozen) scene so the
     rower sees a reason for the stall; the row underneath stays recorded.
     Positioned at the top of the stage so the HUD at the bottom stays
     readable through the loss event. */
  .activity-device-lost-banner {
    position: absolute;
    top: 16px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 60;
    padding: 10px 18px;
    border-radius: 8px;
    font-size: 14px;
    font-weight: 600;
    color: #fff;
    text-align: center;
    max-width: calc(100% - 32px);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  }
  .activity-device-lost-banner--restoring {
    background: rgba(217, 119, 6, 0.95);
  }
  .activity-device-lost-banner--failed {
    background: rgba(185, 28, 28, 0.95);
  }
</style>
