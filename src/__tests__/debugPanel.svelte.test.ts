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
import { clearTelemetry } from '../lib/utils/sceneTelemetryLog';
import { GraphicsQualityStore } from '../lib/ui/graphicsQuality.svelte';
import { clearRenderStats, recordRenderStats, clearContextState } from '../lib/renderer/renderStats';
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
});
