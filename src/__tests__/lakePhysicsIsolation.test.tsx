import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { usePhysicsEngine } from '../hooks/usePhysicsEngine';
import { RouteEnrichmentService } from '../lib/services/routeEnrichmentService';
import { runDetectionInline } from '../lib/services/routeDetectionRunner';
import type { WaterRoute } from '../lib/types/index';

/**
 * #493 NFR4 / AC11: a stalled Overpass fetch never reaches the frame loop.
 * The same ticks give the same boat with and without a fetch hanging for 5 s.
 */
const TICK = 1 / 60;
const FRAMES = 5 * 60;
const pace = { pace: 120, power: undefined, cadence: 28, distance: 0, elapsedTime: 0 };

const row = (between: () => void = () => {}) => {
  const { result } = renderHook(() => usePhysicsEngine());
  for (let frame = 0; frame < FRAMES; frame++) {
    act(() => {
      result.current.dispatchTick(TICK, pace);
    });
    between();
  }
  const { positionM, velocityMps, strokeCycleT } = result.current.boatStateRef.current;
  return { positionM, velocityMps, strokeCycleT };
};

describe('#493 physics isolation (NFR4, AC11)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('rows the same 5 s while an Overpass fetch stalls', async () => {
    const alone = row();

    vi.useFakeTimers();
    let settled = false;
    const stalled = vi.fn(
      () => new Promise<Response>((_resolve, reject) => setTimeout(() => reject(new Error('timed out')), 5_000)),
    ) as unknown as typeof fetch;
    const service = new RouteEnrichmentService(stalled, null, runDetectionInline);
    const route = {
      id: 'stalled',
      name: 'Stalled',
      tags: ['lake'],
      coordinates: [
        { lat: 47.5, lng: 8.5 },
        { lat: 47.51, lng: 8.5 },
      ],
    } as unknown as WaterRoute;
    const pending = service.enrichRoute(route).then((enrichment) => {
      settled = true;
      return enrichment;
    });

    const withFetch = row(() => {
      vi.advanceTimersByTime(TICK * 1000);
    });

    expect(stalled).toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_000);
    const enrichment = await pending;
    expect(settled).toBe(true);
    expect(enrichment.source).toBe('fallback');

    expect(withFetch.positionM).toBeCloseTo(alone.positionM, 3);
    expect(withFetch.velocityMps).toBeCloseTo(alone.velocityMps, 3);
    expect(withFetch.strokeCycleT).toBeCloseTo(alone.strokeCycleT, 3);
  });
});
