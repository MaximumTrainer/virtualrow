import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { flushSync } from 'svelte';
import { RenderStatsReadingStore } from '../lib/ui/renderStatsReading.svelte';
import { recordRenderStats, clearRenderStats } from '../lib/renderer/renderStats';

/**
 * The debug panel polls the render-stats seam only while open (#232). The
 * engine does not feed it yet, so the reading starts empty.
 */
describe('RenderStatsReadingStore (#542)', () => {
  beforeEach(() => {
    clearRenderStats();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts with an empty reading', () => {
    const store = new RenderStatsReadingStore();
    expect(store.reading.stats).toBeNull();
    expect(store.reading.context).toBeNull();
  });

  it('polls what the engine publishes while enabled', () => {
    const cleanup = $effect.root(() => {
      const store = new RenderStatsReadingStore(500);
      store.setEnabled(true);
      flushSync();
      expect(store.reading.stats).toBeNull();

      recordRenderStats({
        backend: 'webgl',
        performanceMode: 'medium',
        drawing: 'webgpu',
        drawCalls: 7,
        triangles: 9,
        sampledAt: Date.now(),
      });
      vi.advanceTimersByTime(500);
      flushSync();
      expect(store.reading.stats?.drawCalls).toBe(7);

      store.stop();
    });
    cleanup();
  });

  it('stops polling when disabled', () => {
    const cleanup = $effect.root(() => {
      const store = new RenderStatsReadingStore(500);
      store.setEnabled(true);
      flushSync();
      store.setEnabled(false);

      recordRenderStats({
        backend: 'webgl',
        performanceMode: 'medium',
        drawing: 'webgpu',
        drawCalls: 11,
        triangles: 9,
        sampledAt: Date.now(),
      });
      vi.advanceTimersByTime(2000);
      flushSync();
      // The last read happened before disabling, when nothing was published.
      expect(store.reading.stats).toBeNull();
    });
    cleanup();
  });
});
