// ============================================================================
// EASING THE BOAT TOWARDS THE DISTANCE THE ROWER HAS COVERED (#295)
//
// While a session is paused the scene follows the distance the rower's machine
// reports rather than integrating a speed, and it eases towards it so a jump in
// the reported figure does not teleport the boat.
//
// The easing was `progress += (target - progress) * delta * 3`, which is a
// first-order filter with a gain of `3 * delta`. That is stable only while the
// gain stays under 1, and it *diverges* past 2 — at which point each frame
// overshoots further than the last:
//
//   delta = 1s:  0.200, -0.150, 0.600, -0.850, 2.100, -3.750, ...
//
// Frames that long are not hypothetical here. Issue #272 records a frame p95 of
// 2784 ms and 6902 ms on the software rasteriser CI runs on, and a rower on
// weak hardware sees the same thing: the boat jitters along the route, or
// teleports past the end of it.
// ============================================================================

/** How quickly the boat closes on the reported distance, per second. */
export const PROGRESS_EASE_PER_SECOND = 3;

/**
 * Where the boat should be after `deltaSeconds`, easing towards `target`.
 *
 * The gain is capped at 1, which is the point at which the boat simply arrives:
 * a frame long enough to want more than that is a frame where easing has
 * nothing left to smooth, and asking for more overshoots rather than arriving
 * sooner.
 */
export const easeProgressTowards = (
  current: number,
  target: number,
  deltaSeconds: number,
): number => {
  if (!Number.isFinite(current) || !Number.isFinite(target)) return current;
  if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0) return current;

  const gain = Math.min(1, deltaSeconds * PROGRESS_EASE_PER_SECOND);
  return current + (target - current) * gain;
};
