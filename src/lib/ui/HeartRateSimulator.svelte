<!--
  HeartRateSimulator (ported to Svelte for #542 P1). Simulates a Bluetooth
  heart-rate monitor without real hardware, through the shared
  `heartRateSimulator` service. DOM, class names and copy kept verbatim vs the
  React component (it reuses PM5Simulator.css) so the Playwright selectors keep
  resolving.
-->
<script lang="ts">
  import { onDestroy } from 'svelte';
  import { heartRateSimulator } from '../services/heartRateSimulatorService';
  import { heartRateBluetoothService } from '../services/heartRateBluetoothService';
  import './PM5Simulator.css';

  interface Props {
    /** Called when the simulator is started */
    onStarted?: () => void;
    /** Called when the simulator is stopped */
    onStopped?: () => void;
  }

  let { onStarted, onStopped }: Props = $props();

  let isActive = $state(heartRateSimulator.isRunning());
  let isExpanded = $state(false);
  let bpm = $state(heartRateSimulator.getBpm());
  let currentBpm = $state<number | null>(null);

  // Track live BPM from the shared HR service.
  const handleSample = (sample: { bpm: number }) => {
    if (heartRateSimulator.isRunning()) currentBpm = sample.bpm;
  };

  heartRateBluetoothService.on('heartRate', handleSample);
  onDestroy(() => heartRateBluetoothService.off('heartRate', handleSample));

  function handleStart() {
    heartRateSimulator.start(bpm);
    isActive = true;
    onStarted?.();
  }

  function handleStop() {
    heartRateSimulator.stop();
    isActive = false;
    currentBpm = null;
    onStopped?.();
  }

  function handleBpmChange(value: number) {
    bpm = value;
    heartRateSimulator.setBpm(value);
  }
</script>

<div class="pm5-simulator-container">
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="simulator-header" onclick={() => (isExpanded = !isExpanded)}>
    <div class="simulator-title">
      <span class="simulator-icon">❤️</span>
      <span>HR Simulator</span>
      {#if isActive}<span class="status-badge active">ACTIVE</span>{/if}
    </div>
    <button class="expand-btn" type="button">
      {isExpanded ? '▼' : '▶'}
    </button>
  </div>

  {#if isExpanded}
    <div class="simulator-content">
      {#if isActive && currentBpm !== null}
        <div class="simulator-live-stat">
          <span class="simulator-live-label">Live HR</span>
          <span class="simulator-live-value">{currentBpm} bpm</span>
        </div>
      {/if}

      <div class="settings-grid">
        <div class="setting-item">
          <!-- svelte-ignore a11y_label_has_associated_control -->
          <label>Target BPM</label>
          <div class="setting-control">
            <input
              type="range"
              min="40"
              max="220"
              value={bpm}
              oninput={(e) => handleBpmChange(Number(e.currentTarget.value))}
            />
            <span class="setting-value">{bpm} bpm</span>
          </div>
        </div>
      </div>

      <div class="simulator-actions">
        {#if !isActive}
          <button class="btn btn-start" onclick={handleStart} type="button">
            ▶ Start HR Simulator
          </button>
        {:else}
          <button class="btn btn-stop" onclick={handleStop} type="button">
            ⏹ Stop
          </button>
        {/if}
      </div>

      <p class="simulator-hint">
        💡 Simulates a Bluetooth heart rate monitor without real hardware
      </p>
    </div>
  {/if}
</div>
