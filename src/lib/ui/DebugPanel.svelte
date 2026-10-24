<!--
  DebugPanel (ported to Svelte for #542 P1). The developer debug window App.tsx
  rendered globally behind the 🐛 toggle: Session override, Graphics tier, the
  PM5 and Heart-Rate simulators, scene Overlays, the render-stats table, the
  scene-telemetry log and the live PM5 / Route / App-state read-outs. DOM, class
  names, ids and copy are kept verbatim vs the React block so the Playwright
  selectors keep resolving (AC2).

  The render-stats table reads the shell↔engine `renderStats` seam. The new
  WebGPU engine does not publish through it yet, so the table shows its real
  "the 3D scene has not drawn a frame" branch until the engine wires it in — the
  same seam pattern as `getFrame`. The scene Overlay toggles persist their
  preference; their effect on the scene is likewise the engine's to consume.
-->
<script lang="ts">
  import type { PM5Data, HeartRateSample } from '../types/index';
  import type { PerformanceMode } from '../../components/rower3d/constants';
  import { debugPreferencesStore } from '../services/debugPreferencesStore';
  import { readTelemetry, telemetryAsText, clearTelemetry } from '../utils/sceneTelemetryLog';
  import { RENDER_BUDGET, overBudget } from '../renderer/renderBudget';
  import { RenderStatsReadingStore } from './renderStatsReading.svelte';
  import type { GraphicsQualityStore } from './graphicsQuality.svelte';
  import GraphicsQualityPicker from './GraphicsQualityPicker.svelte';
  import PM5Simulator from './PM5Simulator.svelte';
  import HeartRateSimulator from './HeartRateSimulator.svelte';
  import './DebugPanel.css';

  interface Props {
    isOpen: boolean;
    onClose: () => void;
    /** The graphics-quality preference store (the picker reads/writes it). */
    graphics: GraphicsQualityStore;
    /** A simulated PM5 frame is fed to the same ride intake the demo uses. */
    onPm5Data?: (data: PM5Data) => void;
    // Live read-outs, from the shell's stores.
    pm5Data: PM5Data | null;
    pm5Connected: boolean;
    heartRateSamples: HeartRateSample[];
    selectedRoute: { name?: string; distance?: number } | null;
    currentView: string;
    isWorkoutActive: boolean;
  }

  let {
    isOpen,
    onClose,
    graphics,
    onPm5Data,
    pm5Data,
    pm5Connected,
    heartRateSamples,
    selectedRoute,
    currentView,
    isWorkoutActive,
  }: Props = $props();

  // Session-flow override (#453 FR6), persisted per browser.
  let showDemoCtaOverride = $state(debugPreferencesStore.getShowDemoCtaOverride());
  // The river guides (#268) and GLB scenery kit (#270) are scene overlays; their
  // switches live here and the engine consumes them (deferred seam).
  let showRiverGuides = $state(true);
  let sceneryEnabled = $state(
    typeof window !== 'undefined' &&
      typeof (window as { __VIRTUALROW_SCENERY_MODELS?: boolean }).__VIRTUALROW_SCENERY_MODELS ===
        'boolean'
      ? (window as { __VIRTUALROW_SCENERY_MODELS?: boolean }).__VIRTUALROW_SCENERY_MODELS!
      : true,
  );
  // Lake outlines (#493 NFR7), persisted like the demo override.
  let lakeOutlines = $state(debugPreferencesStore.getLakeOutlines());

  // Only polled while the panel is open (#232).
  const renderStore = new RenderStatsReadingStore();
  $effect(() => {
    renderStore.setEnabled(isOpen);
    return () => renderStore.stop();
  });

  // The telemetry log is read the same way: only while someone is looking, on
  // the render-stats tick (a good enough clock), plus a bump after Clear.
  let telemetryTick = $state(0);
  const telemetryEvents = $derived.by<ReturnType<typeof readTelemetry>>(() => {
    void renderStore.reading;
    void telemetryTick;
    return isOpen ? readTelemetry() : [];
  });
  const telemetryCount = $derived(telemetryEvents.length);
  const recentTelemetry = $derived(
    telemetryEvents
      .slice(-12)
      .map((e) => {
        const seconds = (e.at / 1000).toFixed(1).padStart(7, ' ');
        return `${seconds}s  ${e.kind}${e.detail ? ` ${JSON.stringify(e.detail)}` : ''}`;
      })
      .join(String.fromCharCode(10)),
  );

  function copyTelemetry() {
    const text = telemetryAsText();
    navigator.clipboard?.writeText(text).catch(() => {
      // Clipboard refused. The download below still works.
    });
  }

  function downloadTelemetry() {
    const blob = new Blob([telemetryAsText()], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `virtualrow-telemetry-${new Date()
      .toISOString()
      .slice(0, 19)
      .replace(/[:T]/g, '-')}.txt`;
    link.click();
    URL.revokeObjectURL(url);
  }
</script>

{#if isOpen}
  <div class="debug-info-panel">
    <div class="debug-panel-header">
      <h4>🔧 Debug Mode</h4>
      <button class="debug-close-btn" onclick={onClose}>✕</button>
    </div>

    <div class="debug-section">
      <h5>Session</h5>
      <label class="debug-toggle-row">
        <input
          type="checkbox"
          checked={showDemoCtaOverride}
          onchange={(e) => {
            const next = e.currentTarget.checked;
            showDemoCtaOverride = next;
            debugPreferencesStore.setShowDemoCtaOverride(next);
          }}
        />
        <span>Show demo-row control on the main screen (signed in)</span>
      </label>
    </div>

    <div class="debug-section">
      <h5>Graphics</h5>
      <GraphicsQualityPicker quality={graphics.quality} onChange={graphics.setQuality} />
    </div>

    <div class="debug-section debug-simulator-section">
      <h5>PM5 Simulator</h5>
      <PM5Simulator onDataReceived={onPm5Data} />
    </div>

    <div class="debug-section debug-simulator-section">
      <h5>Heart Rate Simulator</h5>
      <HeartRateSimulator />
    </div>

    <div class="debug-section">
      <h5>Overlays</h5>
      <label class="debug-toggle-row">
        <input
          type="checkbox"
          checked={showRiverGuides}
          onchange={(e) => (showRiverGuides = e.currentTarget.checked)}
        />
        <span>River guides</span>
      </label>
      <label class="debug-toggle-row">
        <input
          type="checkbox"
          checked={sceneryEnabled}
          onchange={(e) => (sceneryEnabled = e.currentTarget.checked)}
        />
        <span>GLB scenery kit</span>
      </label>
      <label class="debug-toggle-row">
        <input
          type="checkbox"
          checked={lakeOutlines}
          onchange={(e) => {
            const next = e.currentTarget.checked;
            lakeOutlines = next;
            debugPreferencesStore.setLakeOutlines(next);
          }}
        />
        <span>Lake outlines</span>
      </label>
    </div>

    <div class="debug-section">
      <h5>Scene</h5>
      <table class="debug-table">
        <tbody>
          {#if renderStore.reading.stats}
            {@const stats = renderStore.reading.stats}
            <tr
              class={overBudget(stats.performanceMode as PerformanceMode, {
                drawCalls: stats.drawCalls,
              }).length
                ? 'debug-over-budget'
                : undefined}
            >
              <td>Draw calls:</td>
              <td
                >{stats.drawCalls} / {RENDER_BUDGET[stats.performanceMode as PerformanceMode]
                  ?.drawCalls ?? '—'}</td
              >
            </tr>
            <tr
              class={overBudget(stats.performanceMode as PerformanceMode, {
                triangles: stats.triangles,
              }).length
                ? 'debug-over-budget'
                : undefined}
            >
              <td>Triangles:</td>
              <td
                >{stats.triangles.toLocaleString()} / {RENDER_BUDGET[
                  stats.performanceMode as PerformanceMode
                ]?.triangles.toLocaleString() ?? '—'}</td
              >
            </tr>
            <tr><td>FPS:</td><td>{stats.fps?.toFixed(1) ?? 'N/A'}</td></tr>
            <tr
              class={overBudget(stats.performanceMode as PerformanceMode, { p95Ms: stats.p95Ms })
                .length
                ? 'debug-over-budget'
                : undefined}
            >
              <td>Frame p95 (ms):</td>
              <td
                >{stats.p95Ms?.toFixed(1) ?? 'N/A'} / {RENDER_BUDGET[
                  stats.performanceMode as PerformanceMode
                ]?.p95Ms ?? '—'}</td
              >
            </tr>
            <tr><td>Drawing with:</td><td>{stats.drawing}</td></tr>
            <tr><td>Backend detected:</td><td>{stats.backend}</td></tr>
            <tr><td>Quality:</td><td>{stats.performanceMode}</td></tr>
            <tr>
              <td>Drawing:</td>
              <td>{renderStore.reading.stalled ? '⚠️ stalled — no recent frame' : '✅ yes'}</td>
            </tr>
          {:else}
            <tr><td>Drawing:</td><td>❌ the 3D scene has not drawn a frame</td></tr>
          {/if}
          {#if renderStore.reading.context}
            {@const context = renderStore.reading.context}
            <tr><td>GPU adapter:</td><td>{context.powerPreference}</td></tr>
            <tr><td>Antialias:</td><td>{context.antialias ? 'on' : 'off'}</td></tr>
            <tr>
              <td>Context:</td>
              <td>
                {context.lost
                  ? `⚠️ lost${context.lostReason ? ` — ${context.lostReason}` : ''}`
                  : `✅ live${context.losses > 0 ? ` (recovered ${context.losses}×)` : ''}`}
              </td>
            </tr>
            {#if context.fallbackReason}
              <tr><td>Fell back because:</td><td>{context.fallbackReason}</td></tr>
            {/if}
          {/if}
        </tbody>
      </table>
    </div>

    <div class="debug-section">
      <h5>Scene telemetry</h5>
      <p>
        {telemetryCount} event{telemetryCount === 1 ? '' : 's'} recorded this tab. Kept in session
        storage; cleared when the tab closes.
      </p>
      <div class="debug-telemetry-actions">
        <button type="button" class="btn btn-debug-action" onclick={copyTelemetry}>Copy</button>
        <button type="button" class="btn btn-debug-action" onclick={downloadTelemetry}>
          Download
        </button>
        <button
          type="button"
          class="btn btn-debug-action"
          onclick={() => {
            clearTelemetry();
            telemetryTick += 1;
          }}
        >
          Clear
        </button>
      </div>
      <pre class="debug-telemetry-log">{recentTelemetry}</pre>
    </div>

    <div class="debug-section">
      <h5>PM5 Data (Live)</h5>
      <table class="debug-table">
        <tbody>
          <tr><td>Connected:</td><td>{pm5Connected ? '✅ Yes' : '❌ No'}</td></tr>
          <tr><td>Pace (s/500m):</td><td>{pm5Data?.pace ?? 'N/A'}</td></tr>
          <tr
            ><td>Speed (m/s):</td><td>{pm5Data?.pace ? (500 / pm5Data.pace).toFixed(2) : 'N/A'}</td
            ></tr
          >
          <tr><td>Distance (m):</td><td>{pm5Data?.distance?.toFixed(1) ?? 'N/A'}</td></tr>
          <tr><td>Elapsed (s):</td><td>{pm5Data?.elapsedTime ?? 'N/A'}</td></tr>
          <tr><td>Cadence (spm):</td><td>{pm5Data?.cadence ?? 'N/A'}</td></tr>
          <tr><td>Power (W):</td><td>{pm5Data?.power ?? 'N/A'}</td></tr>
          <tr><td>Heart Rate:</td><td>{pm5Data?.heartRate ?? 'N/A'}</td></tr>
        </tbody>
      </table>
    </div>

    {#if currentView === 'workout'}
      <div class="debug-section">
        <h5>Route Visualization (3D View)</h5>
        <p>🔴 Red lines = Water edges (left/right bank)</p>
        <p>🟡 Yellow line = Route centerline</p>
      </div>
    {/if}

    <div class="debug-section">
      <h5>Route Info</h5>
      <table class="debug-table">
        <tbody>
          <tr><td>Route:</td><td>{selectedRoute?.name ?? 'None'}</td></tr>
          <tr><td>Distance (km):</td><td>{selectedRoute?.distance ?? 'N/A'}</td></tr>
          <tr
            ><td>Progress (%):</td><td
              >{pm5Data && selectedRoute?.distance
                ? ((pm5Data.distance / 1000 / selectedRoute.distance) * 100).toFixed(1)
                : '0.0'}</td
            ></tr
          >
        </tbody>
      </table>
    </div>

    <div class="debug-section">
      <h5>App State</h5>
      <table class="debug-table">
        <tbody>
          <tr><td>Current View:</td><td>{currentView}</td></tr>
          <tr><td>Workout Active:</td><td>{isWorkoutActive ? 'Yes' : 'No'}</td></tr>
          <tr><td>HR Samples:</td><td>{heartRateSamples.length}</td></tr>
        </tbody>
      </table>
    </div>
  </div>
{/if}
