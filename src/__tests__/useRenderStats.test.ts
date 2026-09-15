import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useRenderStats, STALL_THRESHOLD_MS } from '../hooks/useRenderStats';
import { recordRenderStats, clearRenderStats } from '../components/rower3d/sceneStats';

const renderer = (calls: number) => {
  const info = {
    autoReset: true,
    render: { calls, triangles: calls * 100 },
    reset: () => {
      info.render.calls = 0;
      info.render.triangles = 0;
    },
  };
  return { info };
};

const record = (calls: number) =>
  recordRenderStats(renderer(calls), { backend: 'webgl', performanceMode: 'high' });

describe('useRenderStats', () => {
  beforeEach(() => {
    clearRenderStats();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('reads nothing while the panel is closed, so a hidden panel costs nothing', () => {
    record(300);

    const { result } = renderHook(() => useRenderStats(false));

    expect(result.current.stats).toBeNull();
  });

  it('reports the scene cost once it is showing', () => {
    record(412);

    const { result } = renderHook(() => useRenderStats(true));

    expect(result.current.stats?.drawCalls).toBe(412);
    expect(result.current.stats?.triangles).toBe(41_200);
  });

  it('keeps up as the scene changes', () => {
    record(100);
    const { result } = renderHook(() => useRenderStats(true, 500));

    record(250);
    act(() => void vi.advanceTimersByTime(600));

    expect(result.current.stats?.drawCalls).toBe(250);
  });

  it('calls out a render loop that has stopped drawing', () => {
    record(120);
    const { result } = renderHook(() => useRenderStats(true, 500));

    expect(result.current.stalled).toBe(false);

    vi.setSystemTime(Date.now() + STALL_THRESHOLD_MS + 1000);
    act(() => void vi.advanceTimersByTime(600));

    expect(result.current.stalled).toBe(true);
  });
});
