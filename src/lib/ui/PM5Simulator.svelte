<!--
  PM5Simulator (ported to Svelte for #542 P1). Drives the app without a real
  PM5 rowing machine by feeding the shared `pm5Simulator` service. DOM, class
  names and copy kept verbatim vs the React component so the Playwright
  selectors keep resolving.
-->
<script lang="ts">
  import { onDestroy } from 'svelte';
  import { pm5Simulator } from '../services/pm5SimulatorService';
  import type { SimulatorSettings } from '../services/pm5SimulatorService';
  import type { PM5Data } from '../types/index';
  import './PM5Simulator.css';

  interface Props {
    onConnected?: (deviceName: string) => void;
    onDisconnected?: () => void;
    onDataReceived?: (data: PM5Data) => void;
  }

  let { onConnected, onDisconnected, onDataReceived }: Props = $props();

  let isActive = $state(false);
  let isExpanded = $state(false);
  let settings = $state<SimulatorSettings>({
    pace: 120,
    cadence: 24,
    heartRate: 130,
    power: 150,
    isRowing: false,
  });

  const handleData = (data: PM5Data) => {
    onDataReceived?.(data);
  };

  pm5Simulator.addListener(handleData);
  onDestroy(() => pm5Simulator.removeListener(handleData));

  function handleStartSimulator() {
    // When starting the simulator, also start rowing automatically.
    const startSettings = { ...settings, isRowing: true };
    pm5Simulator.updateSettings(startSettings);
    pm5Simulator.start();
    settings = startSettings;
    isActive = true;
    onConnected?.('PM5 Simulator');
  }

  function handleStopSimulator() {
    pm5Simulator.stop();
    isActive = false;
    onDisconnected?.();
  }

  function handleToggleRowing() {
    const newIsRowing = !settings.isRowing;
    settings = { ...settings, isRowing: newIsRowing };
    pm5Simulator.updateSettings({ isRowing: newIsRowing });
  }

  function handleSettingChange(key: keyof SimulatorSettings, value: number) {
    settings = { ...settings, [key]: value };
    if (isActive) {
      pm5Simulator.updateSettings({ [key]: value });
    }
  }

  function handleReset() {
    pm5Simulator.reset();
  }

  // Format pace as MM:SS
  const formatPace = (paceSeconds: number): string => {
    const mins = Math.floor(paceSeconds / 60);
    const secs = paceSeconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };
</script>

<div class="pm5-simulator-container">
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="simulator-header" onclick={() => (isExpanded = !isExpanded)}>
    <div class="simulator-title">
      <span class="simulator-icon">🎮</span>
      <span>PM5 Simulator</span>
      {#if isActive}<span class="status-badge active">ACTIVE</span>{/if}
    </div>
    <button class="expand-btn">
      {isExpanded ? '▼' : '▶'}
    </button>
  </div>

  {#if isExpanded}
    <div class="simulator-content">
      {#if !isActive}
        <button class="btn btn-start" onclick={handleStartSimulator}>
          ▶ Start Simulator
        </button>
      {:else}
        <div class="rowing-toggle">
          <button
            class="btn btn-rowing {settings.isRowing ? 'rowing' : 'stopped'}"
            onclick={handleToggleRowing}
          >
            {settings.isRowing ? '🚣 Rowing...' : '⏸ Start Rowing'}
          </button>
        </div>

        <div class="settings-grid">
          <div class="setting-item">
            <!-- svelte-ignore a11y_label_has_associated_control -->
            <label>Pace</label>
            <div class="setting-control">
              <input
                type="range"
                min="80"
                max="180"
                value={settings.pace}
                oninput={(e) => handleSettingChange('pace', Number(e.currentTarget.value))}
              />
              <span class="setting-value">{formatPace(settings.pace)}/500m</span>
            </div>
          </div>

          <div class="setting-item">
            <!-- svelte-ignore a11y_label_has_associated_control -->
            <label>Stroke Rate</label>
            <div class="setting-control">
              <input
                type="range"
                min="16"
                max="40"
                value={settings.cadence}
                oninput={(e) => handleSettingChange('cadence', Number(e.currentTarget.value))}
              />
              <span class="setting-value">{settings.cadence} spm</span>
            </div>
          </div>

          <div class="setting-item">
            <!-- svelte-ignore a11y_label_has_associated_control -->
            <label>Heart Rate</label>
            <div class="setting-control">
              <input
                type="range"
                min="60"
                max="200"
                value={settings.heartRate}
                oninput={(e) => handleSettingChange('heartRate', Number(e.currentTarget.value))}
              />
              <span class="setting-value">{settings.heartRate} bpm</span>
            </div>
          </div>

          <div class="setting-item">
            <!-- svelte-ignore a11y_label_has_associated_control -->
            <label>Power</label>
            <div class="setting-control">
              <input
                type="range"
                min="50"
                max="400"
                value={settings.power}
                oninput={(e) => handleSettingChange('power', Number(e.currentTarget.value))}
              />
              <span class="setting-value">{settings.power} W</span>
            </div>
          </div>
        </div>

        <div class="simulator-actions">
          <button class="btn btn-reset" onclick={handleReset}>
            ↺ Reset
          </button>
          <button class="btn btn-stop" onclick={handleStopSimulator}>
            ⏹ Stop
          </button>
        </div>
      {/if}

      <p class="simulator-hint">
        💡 Use this simulator to test the app without a real PM5 rowing machine
      </p>
    </div>
  {/if}
</div>
