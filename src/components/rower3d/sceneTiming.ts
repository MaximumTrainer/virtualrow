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

let awaitingFirstFrame = false;

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
  clock.clearMeasures(FIRST_FRAME_MEASURE);
  clock.mark(ROUTE_LOAD_MARK);
  awaitingFirstFrame = true;
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
