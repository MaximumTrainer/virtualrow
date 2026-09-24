import { useEffect, useRef, useState } from 'react';

/**
 * Whether the rower has asked the system for less motion (#344).
 *
 * The scene has honoured this since #328 and #329 - the camera's speed-coupled
 * field of view and the hull's pitch and heave both hold still - but it did so
 * through a `matchMedia` effect written inline in `Rower3D.tsx`, so the effect
 * stack could not see it and nothing else could either. It is a hook now, and
 * this is the only place the query string is written down.
 *
 * Watched rather than read once, because the setting can be turned on part-way
 * through a row and the motion it is meant to stop is happening right then.
 *
 * `matchMedia` is missing in jsdom and in some embedded webviews, and its
 * absence is not a preference for motion either way - it is no answer, and no
 * answer means the default, which is the scene as authored.
 */
const QUERY = '(prefers-reduced-motion: reduce)';

const listen = (onChange: (reduced: boolean) => void): (() => void) | undefined => {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
  const query = window.matchMedia(QUERY);
  onChange(query.matches);
  const handler = (event: MediaQueryListEvent) => onChange(event.matches);
  query.addEventListener('change', handler);
  return () => query.removeEventListener('change', handler);
};

/**
 * The preference as state, for anything that renders differently because of it.
 *
 * Changing it re-renders, which is the point: the effect stack is chosen at
 * render time, so a plan that drops an effect has to be recomputed rather than
 * read in a frame loop.
 */
export const useReducedMotion = (): boolean => {
  const [reduced, setReduced] = useState(false);
  useEffect(() => listen(setReduced), []);
  return reduced;
};

/**
 * The same preference as a ref, for the frame loop.
 *
 * The camera rig and the hull read this sixty times a second and must not
 * re-render the scene to learn it. A ref is not a worse version of the state
 * above - it is the right shape for a reader that is already running.
 */
export const useReducedMotionRef = (): React.RefObject<boolean> => {
  const ref = useRef(false);
  useEffect(
    () =>
      listen((reduced) => {
        ref.current = reduced;
      }),
    [],
  );
  return ref;
};
