import { describe, it, expect, beforeEach } from 'vitest';
import {
  readRenderStats,
  recordRenderStats,
  clearRenderStats,
  readContextState,
  recordContextCreated,
  recordContextLost,
  recordContextRestored,
  clearContextState,
  readRenderStatsReading,
  STALL_THRESHOLD_MS,
  type RenderStats,
} from '../lib/renderer/renderStats';

const sample = (over: Partial<RenderStats> = {}): RenderStats => ({
  backend: 'webgl',
  performanceMode: 'medium',
  drawing: 'webgpu',
  drawCalls: 120,
  triangles: 50_000,
  sampledAt: Date.now(),
  ...over,
});

/**
 * The shell↔engine render-stats seam (#542). The engine does not publish
 * through it yet, so the panel relies on the empty reading; these lock that
 * null-until-published behaviour and the writers the engine will call.
 */
describe('renderStats seam (#542)', () => {
  beforeEach(() => {
    clearRenderStats();
    clearContextState();
  });

  it('reads null before anything has been published', () => {
    expect(readRenderStats()).toBeNull();
    expect(readContextState()).toBeNull();
  });

  it('returns an empty, un-stalled reading when the engine has not drawn', () => {
    const reading = readRenderStatsReading();
    expect(reading.stats).toBeNull();
    expect(reading.stalled).toBe(false);
    expect(reading.context).toBeNull();
  });

  it('hands back what the engine published', () => {
    recordRenderStats(sample({ drawCalls: 321 }));
    expect(readRenderStats()?.drawCalls).toBe(321);
  });

  it('counts a reading stale once the sample ages past the threshold', () => {
    const now = 1_000_000;
    recordRenderStats(sample({ sampledAt: now }));
    expect(readRenderStatsReading(now + STALL_THRESHOLD_MS - 1).stalled).toBe(false);
    expect(readRenderStatsReading(now + STALL_THRESHOLD_MS + 1).stalled).toBe(true);
  });

  it('tracks context creation, loss and recovery', () => {
    recordContextCreated({ powerPreference: 'high-performance', antialias: true });
    expect(readContextState()).toMatchObject({ lost: false, losses: 0 });

    recordContextLost('device removed');
    expect(readContextState()).toMatchObject({ lost: true, losses: 1, lostReason: 'device removed' });

    recordContextRestored();
    expect(readContextState()).toMatchObject({ lost: false, losses: 1 });
    expect(readContextState()?.lostReason).toBeUndefined();
  });

  it('ignores a loss reported before any context was created', () => {
    recordContextLost('too early');
    expect(readContextState()).toBeNull();
  });

  it('ignores a recovery reported before any context was created', () => {
    recordContextRestored();
    expect(readContextState()).toBeNull();
  });
});
