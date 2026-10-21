<!--
  HeartRateMonitor — BLE heart-rate connect panel with a current/average/max
  readout (#542 P1, port of HeartRateMonitor.tsx). Same DOM, class names and
  copy so the device specs keep passing; CSS stays global.

  The parent passes `onSample` / `onConnected` / `onDisconnected`: `onSample`
  fires synchronously on every sample (so the shell session store records
  immediately), while the panel's own UI state is deferred to RAF to keep
  renders off the WS/CDP notification stack.
-->
<script lang="ts">
  import { heartRateBluetoothService } from '../services/heartRateBluetoothService';
  import './BluetoothDevice.css';

  interface Props {
    onSample?: (bpm: number) => void;
    onConnected?: () => void;
    onDisconnected?: () => void;
  }

  let { onSample, onConnected, onDisconnected }: Props = $props();

  let connected = $state(false);
  let isConnecting = $state(false);
  let current = $state<number | null>(null);
  let avg = $state<number | null>(null);
  let max = $state<number | null>(null);
  let error = $state<string | null>(null);

  // RAF-based throttle for HR metric display — avoids renders from inside the WS/CDP stack.
  let latestBpm: number | null = null;
  let hrRafScheduled = false;

  $effect(() => {
    const handleHR = (sample: { bpm: number }) => {
      // Notify the parent synchronously so the session store updates immediately.
      onSample?.(sample.bpm);
      // Defer UI state updates to RAF: a clean stack, not inside the
      // WS→characteristic notification chain that causes stack overflows.
      latestBpm = sample.bpm;
      if (!hrRafScheduled) {
        hrRafScheduled = true;
        requestAnimationFrame(() => {
          hrRafScheduled = false;
          const bpm = latestBpm;
          if (bpm == null) return;
          current = bpm;
          const samples = heartRateBluetoothService.getSamples();
          const values = samples.map((s) => s.bpm);
          if (values.length) {
            avg = Math.round(values.reduce((sum, v) => sum + v, 0) / values.length);
            max = values.reduce((m, v) => (v > m ? v : m), values[0]);
          }
        });
      }
    };
    const handleConnected = () => {
      requestAnimationFrame(() => {
        connected = true;
        onConnected?.();
      });
    };
    const handleDisconnected = () => {
      requestAnimationFrame(() => {
        connected = false;
        onDisconnected?.();
      });
    };
    const handleError = (e: unknown) => {
      requestAnimationFrame(() => {
        error = (e instanceof Error ? e.message : String(e)) || 'HR error';
      });
    };

    heartRateBluetoothService.on('heartRate', handleHR);
    heartRateBluetoothService.on('connected', handleConnected);
    heartRateBluetoothService.on('disconnected', handleDisconnected);
    heartRateBluetoothService.on('error', handleError);
    return () => {
      heartRateBluetoothService.off('heartRate', handleHR);
      heartRateBluetoothService.off('connected', handleConnected);
      heartRateBluetoothService.off('disconnected', handleDisconnected);
      heartRateBluetoothService.off('error', handleError);
    };
  });

  async function connect() {
    if (isConnecting) return;
    isConnecting = true;
    error = null;
    try {
      await heartRateBluetoothService.connect();
    } finally {
      isConnecting = false;
    }
  }

  async function disconnect() {
    await heartRateBluetoothService.disconnect();
  }
</script>

<div class="bluetooth-device-container">
  <div class="device-header">
    <div class="device-icon-container">
      <svg
        class="device-icon {connected ? 'connected' : 'disconnected'}"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <path
          d="M20.42 4.58a5.4 5.4 0 0 0-7.65 0l-.77.78-.77-.78a5.4 5.4 0 0 0-7.65 0C1.46 6.7 1.33 10.28 4 13l8 8 8-8c2.67-2.72 2.54-6.3.42-8.42z"
        />
      </svg>
    </div>
    <div class="device-info">
      <h3 class="device-name">Heart Rate Monitor</h3>
      <p class="device-status {connected ? 'connected' : 'disconnected'}">
        {connected ? 'Connected' : 'Disconnected'}
      </p>
    </div>
  </div>

  {#if error}
    <div class="error-message">
      <span class="error-icon">⚠</span>
      <span>{error}</span>
    </div>
  {/if}

  <div class="metrics-grid">
    <div class="metric">
      <div class="metric-label">Current</div>
      <div class="metric-value">{current ?? '--'}</div>
      <div class="metric-unit">bpm</div>
    </div>
    <div class="metric">
      <div class="metric-label">Average</div>
      <div class="metric-value">{avg ?? '--'}</div>
      <div class="metric-unit">bpm</div>
    </div>
    <div class="metric">
      <div class="metric-label">Max</div>
      <div class="metric-value">{max ?? '--'}</div>
      <div class="metric-unit">bpm</div>
    </div>
  </div>

  <div class="device-actions">
    {#if !connected}
      <button class="btn btn-connect" onclick={connect} disabled={isConnecting}>
        {isConnecting ? 'Connecting...' : 'Connect HR Monitor'}
      </button>
    {:else}
      <button class="btn btn-disconnect" onclick={disconnect}>Disconnect</button>
    {/if}
  </div>
</div>
