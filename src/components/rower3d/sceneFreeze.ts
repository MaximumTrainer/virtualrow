// ============================================================================
// sceneFreeze — holding the scene still for a screenshot (#340).
//
// Every visual ticket in the backlog changes pixels, and the only way to tell a
// fix from a regression is to photograph the same frame before and after. The
// scene cannot give the same frame twice while its clock runs: the water waves,
// the boat travels, the oars swing. A spec sets
//
//   window.__ROWER3D_FREEZE = { time: 12.5, progress: 0.31 }
//
// before the app loads, and the readings below are what the animated parts of
// the scene consult instead of the live clock and the live boat position.
//
// These are pure on purpose. The useFrame callbacks that call them are inside
// the R3F scene, which no unit test mounts; a helper that can be tested apart
// from the canvas is the difference between this hook being verified and being
// hoped at.
// ============================================================================

export interface SceneFreeze {
  /** The second on the scene clock that every animated thing should read. */
  time: number;
  /** Where along the route the boat sits, 0 at the start and 1 at the finish. */
  progress: number;
}

/** Whatever object carries the hook — `window` in the app, a literal in a test. */
interface FreezeHost {
  __ROWER3D_FREEZE?: unknown;
}

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const clamp = (value: number, low: number, high: number): number =>
  Math.min(high, Math.max(low, value));

/**
 * The freeze a test asked for, or `null` when the scene should keep running.
 *
 * The hook arrives over an init script, so this is a boundary: a payload that
 * is not two finite numbers is treated as no freeze at all rather than pinning
 * the whole scene to NaN and rendering nothing.
 */
export const readSceneFreeze = (
  host: FreezeHost | undefined = typeof window === 'undefined' ? undefined : window,
): SceneFreeze | null => {
  const raw = host?.__ROWER3D_FREEZE;
  if (!raw || typeof raw !== 'object') return null;

  const { time, progress } = raw as Partial<SceneFreeze>;
  if (!isFiniteNumber(time) || !isFiniteNumber(progress)) return null;

  return { time: Math.max(0, time), progress: clamp(progress, 0, 1) };
};

/** The second the scene should animate at. */
export const frozenClock = (freeze: SceneFreeze | null, liveTime: number): number =>
  freeze ? freeze.time : liveTime;

/** Where along the route the boat should sit. */
export const frozenProgress = (freeze: SceneFreeze | null, liveProgress: number): number =>
  freeze ? freeze.progress : liveProgress;

/**
 * Where in the stroke the oars should be parked.
 *
 * Taken from the fraction of the frozen second, so a frozen frame poses the
 * crew the same way every time without the freeze hook having to carry a third
 * number that means nothing to the spec that sets it.
 */
export const frozenStrokeCycle = (freeze: SceneFreeze | null, liveCycle: number): number =>
  freeze ? freeze.time % 1 : liveCycle;
