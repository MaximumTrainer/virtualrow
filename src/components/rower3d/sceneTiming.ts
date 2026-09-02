// ============================================================================
// First-frame instrumentation (#224).
//
// The number that matters when a route loads is how long the rower stares at
// nothing: the gap between asking for the route curve and the scene's first
// tick. These marks put that gap on the performance timeline where a Playwright
// spec — or a rower's own devtools — can read it.
// ============================================================================

export const ROUTE_LOAD_MARK = 'virtualrow:route-load';
export const FIRST_FRAME_MARK = 'virtualrow:first-frame';
export const FIRST_FRAME_MEASURE = 'virtualrow:route-to-first-frame';
export const GEOMETRY_READY_MARK = 'virtualrow:route-geometry-ready';
export const GEOMETRY_READY_MEASURE = 'virtualrow:route-to-geometry-ready';

let awaitingFirstFrame = false;
let routeLoads = 0;

/**
 * How many times the route geometry has been built this session.
 *
 * One per route the rower picks. More than that means something upstream is
 * handing the scene a fresh `coordinates` array on every render, and the whole
 * spline and its geometry are being rebuilt continuously (#224).
 */
export const routeLoadCount = (): number => routeLoads;

const timeline = (): Performance | null =>
  typeof performance !== 'undefined' && typeof performance.mark === 'function'
    ? performance
    : null;

/** Start the clock: the route curve is about to be built. */
export const markRouteLoadStart = (): void => {
  const clock = timeline();
  if (!clock) return;

  clock.clearMarks(ROUTE_LOAD_MARK);
  clock.clearMarks(FIRST_FRAME_MARK);
  clock.clearMarks(GEOMETRY_READY_MARK);
  clock.clearMeasures(FIRST_FRAME_MEASURE);
  clock.clearMeasures(GEOMETRY_READY_MEASURE);
  clock.mark(ROUTE_LOAD_MARK);
  awaitingFirstFrame = true;
  routeLoads++;
};

/**
 * Stop a second clock once the spline and its distance table exist.
 *
 * This is the part of the wait that is ours: simplification, upsampling, the
 * spline and the lookup table the boat is positioned from. The gap to
 * {@link markFirstFrame} is React committing the scene and the driver
 * compiling shaders, which a software rasteriser dominates and no amount of
 * geometry work will move (#224).
 */
export const markRouteGeometryReady = (): void => {
  const clock = timeline();
  if (!clock || clock.getEntriesByName(ROUTE_LOAD_MARK).length === 0) return;
  if (clock.getEntriesByName(GEOMETRY_READY_MARK).length > 0) return;

  clock.mark(GEOMETRY_READY_MARK);
  clock.measure(GEOMETRY_READY_MEASURE, ROUTE_LOAD_MARK, GEOMETRY_READY_MARK);
};

/**
 * Stop the clock on the scene's first tick.
 *
 * Every later frame is a no-op, so this is safe to call from the render loop.
 */
export const markFirstFrame = (): void => {
  if (!awaitingFirstFrame) return;
  awaitingFirstFrame = false;

  const clock = timeline();
  if (!clock) return;

  clock.mark(FIRST_FRAME_MARK);
  clock.measure(FIRST_FRAME_MEASURE, ROUTE_LOAD_MARK, FIRST_FRAME_MARK);
};
