<!--
  FTMSDevice — BLE connection panel for FTMS-compatible rowing machines
  (WaterRower, Concept2 RowErg, Sunny, NordicTrack RW900, etc.) (#542 P1, port
  of FTMSDevice.tsx). Mirrors BluetoothDevice but uses `ftmsBluetoothService`.
  Same DOM, class names and copy so the device specs keep passing; CSS stays
  global. Like the PM5 panel it owns only its own display — the shell session
  store subscribes to `ftmsBluetoothService` for the workout pipeline.
-->
<script lang="ts">
  import type { BluetoothDeviceState, PM5Data } from '../types/index';
  import { ftmsBluetoothService } from '../services/ftmsBluetoothService';
  import './BluetoothDevice.css';

  let deviceState = $state<BluetoothDeviceState>({ isConnected: false });
  let isConnecting = $state(false);
  let rowerData = $state<PM5Data | null>(null);

  // RAF-based throttle for local FTMS display — avoids renders from inside the WS/CDP stack.
  let latestRowerData: PM5Data | null = null;
  let ftmsRafScheduled = false;

  $effect(() => {
    const handleConnected = (data: unknown) => {
      const d = data as { deviceName?: string };
      const deviceName = d.deviceName ?? 'FTMS Rower';
      requestAnimationFrame(() => {
        deviceState = { ...deviceState, isConnected: true, deviceName };
        isConnecting = false;
      });
    };

    const handleDisconnectedEvent = () => {
      requestAnimationFrame(() => {
        deviceState = { isConnected: false };
        rowerData = null;
      });
    };

    const handleData = (data: unknown) => {
      latestRowerData = data as PM5Data;
      if (!ftmsRafScheduled) {
        ftmsRafScheduled = true;
        requestAnimationFrame(() => {
          ftmsRafScheduled = false;
          if (latestRowerData) rowerData = latestRowerData;
        });
      }
    };

    const handleError = (error: unknown) => {
      const e = error as { message?: string };
      const msg = e.message ?? 'Unknown error';
      requestAnimationFrame(() => {
        deviceState = { ...deviceState, error: msg };
        isConnecting = false;
      });
    };

    ftmsBluetoothService.on('connected', handleConnected);
    ftmsBluetoothService.on('disconnected', handleDisconnectedEvent);
    ftmsBluetoothService.on('data', handleData);
    ftmsBluetoothService.on('error', handleError);

    return () => {
      ftmsBluetoothService.off('connected', handleConnected);
      ftmsBluetoothService.off('disconnected', handleDisconnectedEvent);
      ftmsBluetoothService.off('data', handleData);
      ftmsBluetoothService.off('error', handleError);
    };
  });

  async function handleConnect() {
    isConnecting = true;
    const success = await ftmsBluetoothService.connect();
    if (!success) isConnecting = false;
  }

  async function handleDisconnect() {
    await ftmsBluetoothService.disconnect();
  }

  function formatTime(seconds: number): string {
    const s = Math.floor(seconds);
    const m = Math.floor(s / 60);
    const h = Math.floor(m / 60);
    if (h > 0) {
      return `${h}:${String(m % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
    }
    return `${m}:${String(s % 60).padStart(2, '0')}`;
  }
</script>

<div class="bluetooth-device-container">
  <div class="device-header">
    <div class="device-icon-container">
      <svg
        class="device-icon {deviceState.isConnected ? 'connected' : 'disconnected'}"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
      >
        <path d="M6 9l6 6 6-6" />
        <path d="M9 6l3 3 3-3" />
      </svg>
    </div>
    <div class="device-info">
      <h3 class="device-name">{deviceState.deviceName ?? 'FTMS Rower'}</h3>
      <p class="device-status {deviceState.isConnected ? 'connected' : 'disconnected'}">
        {deviceState.isConnected ? '● Connected' : '● Disconnected'}
      </p>
    </div>
  </div>

  {#if rowerData}
    <div class="metrics-grid">
      <div class="metric">
        <span class="metric-label">Pace</span>
        <span class="metric-value">{rowerData.pace ? rowerData.pace.toFixed(1) : '--'}</span>
        <span class="metric-unit">s/500m</span>
      </div>
      <div class="metric">
        <span class="metric-label">Distance</span>
        <span class="metric-value">{(rowerData.distance / 1000).toFixed(2)}</span>
        <span class="metric-unit">km</span>
      </div>
      <div class="metric">
        <span class="metric-label">Time</span>
        <span class="metric-value">{formatTime(rowerData.elapsedTime)}</span>
        <span class="metric-unit">—</span>
      </div>
      {#if rowerData.power !== undefined}
        <div class="metric">
          <span class="metric-label">Power</span>
          <span class="metric-value">{rowerData.power}</span>
          <span class="metric-unit">W</span>
        </div>
      {/if}
      {#if rowerData.cadence !== undefined && rowerData.cadence > 0}
        <div class="metric">
          <span class="metric-label">Rate</span>
          <span class="metric-value">{rowerData.cadence}</span>
          <span class="metric-unit">spm</span>
        </div>
      {/if}
      {#if rowerData.heartRate !== undefined && rowerData.heartRate > 0}
        <div class="metric">
          <span class="metric-label">HR</span>
          <span class="metric-value">{rowerData.heartRate}</span>
          <span class="metric-unit">bpm</span>
        </div>
      {/if}
    </div>
  {/if}

  {#if deviceState.error}
    <div class="error-message">
      <span class="error-icon">⚠</span>
      <span>{deviceState.error}</span>
    </div>
  {/if}

  <div class="device-actions">
    {#if !deviceState.isConnected}
      <button class="btn btn-connect" onclick={handleConnect} disabled={isConnecting}>
        {isConnecting ? 'Connecting...' : 'Connect FTMS Rower'}
      </button>
    {:else}
      <button class="btn btn-disconnect" onclick={handleDisconnect}>Disconnect</button>
    {/if}
  </div>

  <p class="device-note">
    Connect any FTMS-compatible rowing machine (WaterRower, Concept2 RowErg, etc.)
  </p>
</div>
