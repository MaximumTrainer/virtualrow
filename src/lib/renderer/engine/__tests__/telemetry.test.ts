import { afterEach, describe, expect, it } from 'vitest';
import { createTelemetry, publishSpeedMps, releaseTelemetry } from '../telemetry';

type Win = typeof window & {
  __ROWER3D_RENDER_STATS?: { draws: number; drawCalls: number } | unknown;
  __ROWER3D_FRAME_STATS?: unknown;
  __ROWER3D_CAMERA?: unknown;
  __ROWER3D_CONTEXT_STATE?: unknown;
  __ROWER3D_POS?: unknown;
  __ROWER3D_ROUTE?: unknown;
  __ROWER3D_CLEARANCE?: unknown;
  __ROWER3D_FORCE_RENDER?: unknown;
  __ROWER3D_GPU_BACKEND?: unknown;
  __ROWER3D_FOLIAGE?: unknown;
  __ROWER3D_SCENERY?: unknown;
  __ROWER3D_BUILDINGS?: unknown;
  __ROWER3D_SPEED_MPS?: number;
};

afterEach(() => {
  releaseTelemetry();
});

describe('telemetry', () => {
  it('publishes the __ROWER3D_* globals the three scene publishes on main', () => {
    const w = window as Win;
    expect(w.__ROWER3D_RENDER_STATS).toBeUndefined();

    const handles = createTelemetry(() => undefined);
    const keys = [
      '__ROWER3D_RENDER_STATS',
      '__ROWER3D_FRAME_STATS',
      '__ROWER3D_CAMERA',
      '__ROWER3D_CONTEXT_STATE',
      '__ROWER3D_POS',
      '__ROWER3D_ROUTE',
      '__ROWER3D_CLEARANCE',
      '__ROWER3D_FORCE_RENDER',
      '__ROWER3D_GPU_BACKEND',
      '__ROWER3D_FOLIAGE',
      '__ROWER3D_SCENERY',
      '__ROWER3D_BUILDINGS',
    ] as const;
    for (const key of keys) {
      expect(w[key]).toBeDefined();
    }
    // Known main-branch shape (`src/lib/types/index.ts` lines 367+).
    const stats = handles.renderStats as {
      draws: number;
      triangles: number;
      instances: number;
      sceneryDispatch: number;
      sceneryDraws: number;
      sceneryTriangles: number;
    };
    expect(stats).toMatchObject({
      draws: expect.any(Number),
      triangles: expect.any(Number),
      instances: expect.any(Number),
      sceneryDispatch: expect.any(Number),
      sceneryDraws: expect.any(Number),
      sceneryTriangles: expect.any(Number),
    });
    expect(handles.contextState).toMatchObject({ kind: 'pending', backend: 'none' });
    // #555 FR6: foliage shape matches the main scene's publishFoliage writes.
    expect(handles.foliage).toMatchObject({
      trees: expect.any(Number),
      meshes: expect.any(Number),
      drawn: expect.any(Number),
    });
    // #555 FR6: scenery is a {pools, dispatchCount, drawCount} bag.
    expect(handles.scenery).toMatchObject({
      pools: expect.any(Array),
      dispatchCount: expect.any(Number),
      drawCount: expect.any(Number),
    });
    // #566 FR1/AC8: buildings telemetry is published and defaults to zero.
    expect(handles.buildings).toMatchObject({
      routes: 0,
      drawn: 0,
      pool: 0,
      triangles: 0,
      footprintM2: 0,
      resident: false,
      cast: false,
    });
  });

  it('clears every global on release', () => {
    createTelemetry(() => undefined);
    releaseTelemetry();
    const w = window as Win;
    expect(w.__ROWER3D_RENDER_STATS).toBeUndefined();
    expect(w.__ROWER3D_FORCE_RENDER).toBeUndefined();
    expect(w.__ROWER3D_GPU_BACKEND).toBeUndefined();
    expect(w.__ROWER3D_FOLIAGE).toBeUndefined();
    expect(w.__ROWER3D_SCENERY).toBeUndefined();
    expect(w.__ROWER3D_BUILDINGS).toBeUndefined();
    expect(w.__ROWER3D_SPEED_MPS).toBeUndefined();
  });

  it('__ROWER3D_RENDER_STATS.drawCalls aliases .draws (legacy spec harness)', () => {
    const handles = createTelemetry(() => undefined);
    const stats = handles.renderStats as { draws: number; drawCalls: number };
    expect(stats.drawCalls).toBe(0);
    stats.draws = 42;
    expect(stats.drawCalls).toBe(42);
    const published = (window as Win).__ROWER3D_RENDER_STATS as { drawCalls: number };
    expect(published.drawCalls).toBe(42);
  });

  it('publishSpeedMps writes the scalar to window.__ROWER3D_SPEED_MPS', () => {
    const handles = createTelemetry(() => undefined);
    const w = window as Win;
    expect(w.__ROWER3D_SPEED_MPS).toBe(0);
    publishSpeedMps(handles, 4.25);
    expect(w.__ROWER3D_SPEED_MPS).toBe(4.25);
    expect(handles.speed.value).toBe(4.25);
    publishSpeedMps(handles, 0);
    expect(w.__ROWER3D_SPEED_MPS).toBe(0);
  });
});
