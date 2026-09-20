import { useEffect, useState } from 'react';
import type { LoadProgress } from '../utils/loadingProgress';
import { BOAT_UNAVAILABLE_MESSAGE } from '../utils/loadingProgress';
import './RouteLoadingBar.css';

/**
 * How much of the route load is done (#318).
 *
 * Replaces a line of static text that was dismissed when the scene's code
 * chunk resolved — 0.7 s into a 3.2 s wait, leaving the rower looking at an
 * empty stage while the largest download of the lot was still in flight.
 *
 * A real `role="progressbar"` rather than a styled div: a rower using a screen
 * reader gets the same number everyone else does, and a spec can read it
 * without knowing how it is drawn.
 *
 * It owns its own visibility, because the two things it shows go at different
 * times. The bar goes when the wait is over; a boat that could not be fetched
 * is still true afterwards, and the rower is about to notice a river with no
 * boat in it.
 */

/**
 * How long the filled bar stays up once the wait is over.
 *
 * Without it the bar is removed in the same render that completes it, so it
 * jumps from its last phase straight to nothing and never shows the finish —
 * measured going 45% -> gone. This delays the *dismissal* only; the value
 * itself still moves only when a phase settles, which is the property that
 * keeps this from being a timer.
 */
const FINISHED_HOLD_MS = 400;

interface RouteLoadingBarProps {
  progress: LoadProgress;
}

export function RouteLoadingBar({ progress }: RouteLoadingBarProps) {
  const boatMissing = progress.failed.includes('boat');

  // The hold is released by the timer below, never synchronously in the
  // effect body — React's compiler rules reject that, and cascading renders
  // are a real cost on a page that is already assembling a 3D scene.
  const [held, setHeld] = useState(false);
  const [wasComplete, setWasComplete] = useState(progress.complete);
  if (wasComplete !== progress.complete) {
    setWasComplete(progress.complete);
    setHeld(progress.complete);
  }

  useEffect(() => {
    if (!progress.complete) return;
    const timer = setTimeout(() => setHeld(false), FINISHED_HOLD_MS);
    return () => clearTimeout(timer);
  }, [progress.complete]);

  const showBar = !progress.complete || held;

  if (!showBar && !boatMissing) return null;

  return (
    <div className="route-loading" data-loaded={progress.complete ? 'loaded' : 'loading'}>
      {showBar && (
        <>
          <div
            className="route-loading-bar"
            role="progressbar"
            aria-label="Loading the 3D view"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progress.percent}
            aria-valuetext={progress.phase}
          >
            <div className="route-loading-fill" style={{ width: `${progress.percent}%` }} />
          </div>

          <p className="route-loading-phase">
            {progress.phase}
            <span className="route-loading-percent"> {progress.percent}%</span>
          </p>
        </>
      )}

      {boatMissing && (
        <p className="route-loading-warning" role="status">
          {BOAT_UNAVAILABLE_MESSAGE}
        </p>
      )}
    </div>
  );
}
