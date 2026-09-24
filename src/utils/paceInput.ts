/**
 * Reading a target pace the way a rower types it (#338).
 *
 * Its own module because `GhostPicker` is a component, and a file that exports
 * both a component and a helper loses fast refresh for the component.
 */

/** Paces a boat is actually rowed at, in seconds per 500 m. */
const FASTEST_PACE = 60;
const SLOWEST_PACE = 540;

/** The pace a pace boat starts at, until the rower says otherwise. */
export const DEFAULT_TARGET_PACE = 120;

/**
 * Read `2:05` as 125 seconds.
 *
 * Returns null for anything that is not yet a pace - a half-typed `2:` most of
 * all, because a boat that jumped to 2 s/500 m the moment the colon was typed
 * would be over the horizon before the rower finished the number.
 */
export const parsePaceInput = (text: string): number | null => {
  const match = text.trim().match(/^(\d{1,2}):([0-5]\d)$/);
  if (!match) return null;
  const seconds = Number(match[1]) * 60 + Number(match[2]);
  return seconds >= FASTEST_PACE && seconds <= SLOWEST_PACE ? seconds : null;
};
