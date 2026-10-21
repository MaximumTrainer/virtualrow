<!--
  BluetoothDevice — connect/disconnect panel for a Concept2 PM5 with a small live
  readout (#542 P1, port of BluetoothDevice.tsx). Same DOM, class names, copy and
  SVG markers so the device Playwright specs keep passing; the CSS is imported
  verbatim and stays global.

  Like the React panel it owns nothing but its own display: the workout pipeline
  subscribes to `bluetoothService` from the shell session store (see the ported
  `useRowerServiceEvents`), where the subscription survives the switch to the
  workout view, so no data/connection callbacks are reintroduced here.
-->
<script lang="ts">
  import type { BluetoothDeviceState, PM5Data } from '../types/index';
  import { bluetoothService } from '../services/bluetoothService';
  import './BluetoothDevice.css';

  let deviceState = $state<BluetoothDeviceState>({ isConnected: false });
  let isConnecting = $state(false);
  let pm5Data = $state<PM5Data | null>(null);

  // RAF-based throttle for local PM5 display — avoids renders from inside the
  // WS/CDP stack (prevents "Maximum call stack size exceeded" under Playwright).
  let latestPM5Data: PM5Data | null = null;
  let pm5RafScheduled = false;

  $effect(() => {
    const handleConnected = (data: unknown) => {
      const connectionData = data as { deviceName?: string };
      const deviceName = connectionData.deviceName || 'Concept2 PM5';
      requestAnimationFrame(() => {
        deviceState = { ...deviceState, isConnected: true, deviceName };
        isConnecting = false;
      });
    };

    const handleDisconnectedEvent = () => {
      requestAnimationFrame(() => {
        deviceState = { isConnected: false };
        pm5Data = null;
      });
    };

    const handleData = (data: unknown) => {
      latestPM5Data = data as PM5Data;
      if (!pm5RafScheduled) {
        pm5RafScheduled = true;
        requestAnimationFrame(() => {
          pm5RafScheduled = false;
          if (latestPM5Data) pm5Data = latestPM5Data;
        });
      }
    };

    const handleError = (error: unknown) => {
      const errorData = error as { message?: string };
      const errorMsg = errorData.message || 'Unknown error occurred';
      requestAnimationFrame(() => {
        deviceState = { ...deviceState, error: errorMsg };
        isConnecting = false;
      });
    };

    bluetoothService.on('connected', handleConnected);
    bluetoothService.on('disconnected', handleDisconnectedEvent);
    bluetoothService.on('data', handleData);
    bluetoothService.on('error', handleError);

    // We intentionally do NOT disconnect the device here, to keep the connection.
    return () => {
      bluetoothService.off('connected', handleConnected);
      bluetoothService.off('disconnected', handleDisconnectedEvent);
      bluetoothService.off('data', handleData);
      bluetoothService.off('error', handleError);
    };
  });

  async function handleConnect() {
    isConnecting = true;
    const success = await bluetoothService.connect();
    if (!success) isConnecting = false;
  }

  async function handleDisconnect() {
    await bluetoothService.disconnect();
  }

  function formatTime(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    if (hours > 0) {
      return `${hours}:${String(minutes % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
    }
    return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
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
      <h3 class="device-name">{deviceState.deviceName || 'Concept2 PM5'}</h3>
      <p class="device-status {deviceState.isConnected ? 'connected' : 'disconnected'}">
        {deviceState.isConnected ? '● Connected' : '● Disconnected'}
      </p>
    </div>
  </div>

  {#if pm5Data}
    <div class="metrics-grid">
      <div class="metric">
        <span class="metric-label">Pace</span>
        <span class="metric-value">{pm5Data.pace ? pm5Data.pace.toFixed(1) : '--'}</span>
        <span class="metric-unit">s/500m</span>
      </div>
      <div class="metric">
        <span class="metric-label">Distance</span>
        <span class="metric-value">{(pm5Data.distance / 1000).toFixed(2)}</span>
        <span class="metric-unit">km</span>
      </div>
      <div class="metric">
        <span class="metric-label">Time</span>
        <span class="metric-value">{formatTime(pm5Data.elapsedTime)}</span>
        <span class="metric-unit">—</span>
      </div>
      {#if pm5Data.power !== undefined}
        <div class="metric">
          <span class="metric-label">Power</span>
          <span class="metric-value">{pm5Data.power}</span>
          <span class="metric-unit">W</span>
        </div>
      {/if}
      {#if pm5Data.cadence !== undefined}
        <div class="metric">
          <span class="metric-label">Cadence</span>
          <span class="metric-value">{pm5Data.cadence}</span>
          <span class="metric-unit">spm</span>
        </div>
      {/if}
      {#if pm5Data.heartRate !== undefined && pm5Data.heartRate > 0}
        <div class="metric">
          <span class="metric-label">Heart Rate</span>
          <span class="metric-value">{pm5Data.heartRate}</span>
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
        {isConnecting ? 'Connecting...' : 'Connect PM5'}
      </button>
    {:else}
      <button class="btn btn-disconnect" onclick={handleDisconnect}>Disconnect</button>
    {/if}
  </div>

  <p class="device-note">Make sure your Concept2 PM5 is powered on and nearby</p>
</div>
