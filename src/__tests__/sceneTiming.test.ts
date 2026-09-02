import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * The module carries a one-shot latch, so each test gets a fresh copy rather
 * than inheriting whether the previous one had already fired.
 */
const loadTiming = async () => {
  vi.resetModules();
  return import('../components/rower3d/sceneTiming');
};

describe('scene timing marks', () => {
  beforeEach(() => {
    performance.clearMarks();
    performance.clearMeasures();
  });

  it('measures the gap between asking for a route and the first tick', async () => {
    const { markRouteLoadStart, markFirstFrame, FIRST_FRAME_MEASURE } = await loadTiming();

    markRouteLoadStart();
    markFirstFrame();

    const [measure] = performance.getEntriesByName(FIRST_FRAME_MEASURE);
    expect(measure).toBeDefined();
    expect(measure.duration).toBeGreaterThanOrEqual(0);
  });

  it('records nothing for a frame that follows no route load', async () => {
    const { markFirstFrame, FIRST_FRAME_MEASURE, FIRST_FRAME_MARK } = await loadTiming();

    markFirstFrame();

    expect(performance.getEntriesByName(FIRST_FRAME_MEASURE)).toHaveLength(0);
    expect(performance.getEntriesByName(FIRST_FRAME_MARK)).toHaveLength(0);
  });

  it('measures the first tick only, not every frame after it', async () => {
    const { markRouteLoadStart, markFirstFrame, FIRST_FRAME_MARK } = await loadTiming();

    markRouteLoadStart();
    markFirstFrame();
    markFirstFrame();
    markFirstFrame();

    expect(performance.getEntriesByName(FIRST_FRAME_MARK)).toHaveLength(1);
  });

  it('starts a clean clock for the next route the rower picks', async () => {
    const { markRouteLoadStart, markFirstFrame, FIRST_FRAME_MEASURE } = await loadTiming();

    markRouteLoadStart();
    markFirstFrame();
    markRouteLoadStart();

    expect(performance.getEntriesByName(FIRST_FRAME_MEASURE)).toHaveLength(0);

    markFirstFrame();
    expect(performance.getEntriesByName(FIRST_FRAME_MEASURE)).toHaveLength(1);
  });

  it('stays quiet where the browser exposes no performance timeline', async () => {
    vi.stubGlobal('performance', undefined);
    const { markRouteLoadStart, markFirstFrame } = await loadTiming();

    expect(() => {
      markRouteLoadStart();
      markFirstFrame();
    }).not.toThrow();

    vi.unstubAllGlobals();
  });
});

describe('route geometry timing', () => {
  beforeEach(() => {
    performance.clearMarks();
    performance.clearMeasures();
  });

  it('measures the part of the wait that is the route geometry', async () => {
    const { markRouteLoadStart, markRouteGeometryReady, GEOMETRY_READY_MEASURE } =
      await loadTiming();

    markRouteLoadStart();
    markRouteGeometryReady();

    const [measure] = performance.getEntriesByName(GEOMETRY_READY_MEASURE);
    expect(measure).toBeDefined();
    expect(measure.duration).toBeGreaterThanOrEqual(0);
  });

  it('records nothing when no route load was marked', async () => {
    const { markRouteGeometryReady, GEOMETRY_READY_MEASURE } = await loadTiming();
    markRouteGeometryReady();
    expect(performance.getEntriesByName(GEOMETRY_READY_MEASURE)).toHaveLength(0);
  });

  it('measures the first build only, not every re-render', async () => {
    const { markRouteLoadStart, markRouteGeometryReady, GEOMETRY_READY_MARK } = await loadTiming();
    markRouteLoadStart();
    markRouteGeometryReady();
    markRouteGeometryReady();
    expect(performance.getEntriesByName(GEOMETRY_READY_MARK)).toHaveLength(1);
  });

  it('starts a clean clock for the next route', async () => {
    const { markRouteLoadStart, markRouteGeometryReady, GEOMETRY_READY_MEASURE } =
      await loadTiming();
    markRouteLoadStart();
    markRouteGeometryReady();
    markRouteLoadStart();
    expect(performance.getEntriesByName(GEOMETRY_READY_MEASURE)).toHaveLength(0);

    markRouteGeometryReady();
    expect(performance.getEntriesByName(GEOMETRY_READY_MEASURE)).toHaveLength(1);
  });
});
