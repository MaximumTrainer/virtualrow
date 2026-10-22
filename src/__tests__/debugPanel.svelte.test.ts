import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';

// The simulators reach real singletons at mount; stub them so the panel test
// stays about the panel.
vi.mock('../lib/services/pm5SimulatorService', () => ({
  pm5Simulator: { addListener: vi.fn(), removeListener: vi.fn(), start: vi.fn(), stop: vi.fn(), reset: vi.fn(), updateSettings: vi.fn() },
}));
vi.mock('../lib/services/heartRateSimulatorService', () => ({
  heartRateSimulator: { isRunning: () => false, getBpm: () => 130, setBpm: vi.fn(), start: vi.fn(), stop: vi.fn() },
}));
vi.mock('../lib/services/heartRateBluetoothService', () => ({
  heartRateBluetoothService: { on: vi.fn(), off: vi.fn() },
}));

const telemetry = vi.hoisted(() => ({
  events: [] as Array<{ at: number; kind: string; detail?: unknown }>,
}));
vi.mock('../lib/utils/sceneTelemetryLog', () => ({
  readTelemetry: () => [...telemetry.events],
  telemetryAsText: () => 'text',
  clearTelemetry: vi.fn(() => {
    telemetry.events = [];
  }),
}));

import DebugPanel from '../lib/ui/DebugPanel.svelte';
import { clearTelemetry, telemetryAsText } from '../lib/utils/sceneTelemetryLog';
import { GraphicsQualityStore } from '../lib/ui/graphicsQuality.svelte';
import {
  clearRenderStats,
  recordRenderStats,
  clearContextState,
  recordContextCreated,
  recordContextLost,
  recordContextRestored,
} from '../lib/renderer/renderStats';
import { debugPreferencesStore } from '../lib/services/debugPreferencesStore';

const baseProps = () => ({
  isOpen: true,
  onClose: vi.fn(),
  graphics: new GraphicsQualityStore(),
  onPm5Data: vi.fn(),
  pm5Data: null,
  pm5Connected: false,
  heartRateSamples: [],
  selectedRoute: null,
  currentView: 'routes',
  isWorkoutActive: false,
});

describe('DebugPanel (#542 port of the App debug window)', () => {
  beforeEach(() => {
    localStorage.clear();
    telemetry.events = [];
    clearRenderStats();
    clearContextState();
    vi.clearAllMocks();
  });

  it('renders nothing when closed', () => {
    const { container } = render(DebugPanel, { ...baseProps(), isOpen: false });
    expect(container.querySelector('.debug-info-panel')).toBeNull();
  });

  it('renders every section when open', () => {
    render(DebugPanel, baseProps());
    expect(screen.getByText('🔧 Debug Mode')).toBeTruthy();
    for (const heading of [
      'Session',
      'Graphics',
      'PM5 Simulator',
      'Heart Rate Simulator',
      'Overlays',
      'Scene',
      'Scene telemetry',
      'PM5 Data (Live)',
      'Route Info',
      'App State',
    ]) {
      expect(screen.getByRole('heading', { name: heading })).toBeTruthy();
    }
  });

  it('shows the render-stats empty branch until the engine draws a frame', () => {
    render(DebugPanel, baseProps());
    expect(screen.getByText('❌ the 3D scene has not drawn a frame')).toBeTruthy();
  });

  it('calls onClose from the close button', async () => {
    const onClose = vi.fn();
    render(DebugPanel, { ...baseProps(), onClose });
    await fireEvent.click(screen.getByRole('button', { name: '✕' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('persists the lake-outlines overlay toggle', async () => {
    render(DebugPanel, baseProps());
    const lake = screen.getByText('Lake outlines').previousElementSibling as HTMLInputElement;
    expect(debugPreferencesStore.getLakeOutlines()).toBe(false);
    await fireEvent.click(lake);
    expect(debugPreferencesStore.getLakeOutlines()).toBe(true);
  });

  it('reports the telemetry count and clears it', async () => {
    telemetry.events = [{ at: 1000, kind: 'contextLost' }];
    render(DebugPanel, baseProps());
    expect(screen.getByText(/1 event recorded this tab/)).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(clearTelemetry).toHaveBeenCalled();
  });

  it('shows the Route Visualization section only during a workout', () => {
    const { unmount } = render(DebugPanel, baseProps());
    expect(screen.queryByRole('heading', { name: /Route Visualization/ })).toBeNull();
    unmount();
    render(DebugPanel, { ...baseProps(), currentView: 'workout' });
    expect(screen.getByRole('heading', { name: /Route Visualization/ })).toBeTruthy();
  });

  it('reflects published render stats, flagging an over-budget frame', async () => {
    render(DebugPanel, baseProps());
    recordRenderStats({
      backend: 'webgl',
      performanceMode: 'basic',
      drawing: 'webgpu',
      drawCalls: 100000,
      triangles: 10,
      sampledAt: Date.now(),
    });
    // The panel polls every 500ms while open.
    expect(await screen.findByText(/Draw calls:/, {}, { timeout: 1500 })).toBeTruthy();
  });

  it('renders the full stats table and a live context when the engine has drawn', async () => {
    recordContextCreated({
      powerPreference: 'low-power',
      antialias: false,
      fallbackReason: 'reused a context without multisampling',
    });
    recordRenderStats({
      backend: 'webgl',
      performanceMode: 'high',
      drawing: 'webgpu',
      drawCalls: 10,
      triangles: 1000,
      fps: 59.7,
      p95Ms: 12.3,
      sampledAt: Date.now(),
    });
    render(DebugPanel, {
      ...baseProps(),
      pm5Connected: true,
      pm5Data: {
        pace: 125,
        distance: 500,
        elapsedTime: 60,
        cadence: 24,
        power: 180,
        heartRate: 140,
      } as never,
      selectedRoute: { name: 'The Thames', distance: 2 },
      currentView: 'workout',
      isWorkoutActive: true,
    });
    // Live context, antialias off, the fallback reason row, and the fresh-frame
    // "drawing: yes" branch.
    expect(await screen.findByText('✅ yes', {}, { timeout: 1500 })).toBeTruthy();
    expect(screen.getByText('off')).toBeTruthy();
    expect(screen.getByText(/reused a context without multisampling/)).toBeTruthy();
    expect(screen.getByText(/✅ live/)).toBeTruthy();
    // PM5 speed is derived from pace, and route progress from distance.
    expect(screen.getByText('4.00')).toBeTruthy(); // 500 / 125 m/s
    expect(screen.getByText('✅ Yes')).toBeTruthy(); // connected
    expect(screen.getByText('The Thames')).toBeTruthy();
    expect(screen.getByRole('heading', { name: /Route Visualization/ })).toBeTruthy();
  });

  it('flags a lost context and a stalled render loop', async () => {
    recordContextCreated({ powerPreference: 'high-performance', antialias: true });
    recordContextLost('device removed');
    recordRenderStats({
      backend: 'none',
      performanceMode: 'medium',
      drawing: 'unknown',
      drawCalls: 10,
      triangles: 10,
      sampledAt: Date.now() - 5000, // older than the stall threshold
    });
    render(DebugPanel, baseProps());
    expect(
      await screen.findByText(/⚠️ stalled — no recent frame/, {}, { timeout: 1500 }),
    ).toBeTruthy();
    expect(screen.getByText(/⚠️ lost — device removed/)).toBeTruthy();
  });

  it('reports how many times a recovered context was lost', async () => {
    recordContextCreated({ powerPreference: 'default', antialias: true });
    recordContextLost();
    recordContextRestored();
    recordRenderStats({
      backend: 'webgl',
      performanceMode: 'medium',
      drawing: 'webgpu',
      drawCalls: 10,
      triangles: 10,
      sampledAt: Date.now(),
    });
    render(DebugPanel, baseProps());
    expect(await screen.findByText(/✅ live \(recovered 1×\)/, {}, { timeout: 1500 })).toBeTruthy();
  });

  it('toggles the river-guides and scenery overlays', async () => {
    render(DebugPanel, baseProps());
    const river = screen.getByText('River guides').previousElementSibling as HTMLInputElement;
    const scenery = screen.getByText('GLB scenery kit').previousElementSibling as HTMLInputElement;
    expect(river.checked).toBe(true);
    await fireEvent.click(river);
    expect(river.checked).toBe(false);
    await fireEvent.click(scenery);
    expect(scenery.checked).toBe(false);
  });

  it('copies and downloads the telemetry log', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const origClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    const createObjectURL = vi.fn(() => 'blob:x');
    const revokeObjectURL = vi.fn();
    const origCreate = URL.createObjectURL;
    const origRevoke = URL.revokeObjectURL;
    URL.createObjectURL = createObjectURL as unknown as typeof URL.createObjectURL;
    URL.revokeObjectURL = revokeObjectURL as unknown as typeof URL.revokeObjectURL;

    try {
      render(DebugPanel, baseProps());
      await fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
      expect(writeText).toHaveBeenCalledWith(telemetryAsText());
      await fireEvent.click(screen.getByRole('button', { name: 'Download' }));
      expect(createObjectURL).toHaveBeenCalled();
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:x');
    } finally {
      URL.createObjectURL = origCreate;
      URL.revokeObjectURL = origRevoke;
      if (origClipboard) Object.defineProperty(navigator, 'clipboard', origClipboard);
      else delete (navigator as { clipboard?: unknown }).clipboard;
    }
  });
});
