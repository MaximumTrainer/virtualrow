import { useEffect, useRef, useState } from 'react';
import {
  describeLoadProgress,
  type LoadPhaseKey,
  type LoadProgress,
} from '../utils/loadingProgress';
import { FIRST_FRAME_MARK, GEOMETRY_READY_MARK } from '../components/rower3d/sceneTiming';

/**
 * Watch a route load without touching the thing being loaded.
 *
 * Every phase is read off the performance timeline — two marks the scene
 * already writes for #224, and two resource entries the browser records for
 * downloads it was going to make anyway. Nothing here subscribes to the
 * scene's Suspense boundary or to `useGLTF`.
 *
 * That is deliberate and is the reason this is affordable at all. The boat
 * renders inside the Canvas's own inner `<Suspense>`, added by `2a4d160`
 * because a late asset suspending outside it disposed the renderer mid-row —
 * measured at a context created at 1.6 s and lost at 6.0 s. Reaching into that
 * boundary to learn when the boat arrived is how this fix would have
 * reintroduced the bug it has nothing to do with.
 */

/** The lazily-loaded scene chunk, whose filename carries a build hash. */
const VIEW_CHUNK = /Rower3D-[^/]*\.js(\?|$)/;

/** How often the timeline is read. */
const POLL_MS = 100;

/**
 * How long to wait for the boat before calling it lost.
 *
 * A backstop, not a clock. The bar's *value* only ever moves when a phase
 * settles — this decides when an outstanding phase has settled as `failed`,
 * which is a different question. It is generous because a slow connection is
 * not a failure, and the cost of being wrong is telling a rower their boat is
 * missing while it is still arriving.
 *
 * A failed request usually declares itself sooner: Chrome records a resource
 * entry with `responseStatus` for a 503, and that path does not wait.
 */
const BOAT_GIVE_UP_MS = 20_000;

interface ResourceOutcome {
  seen: boolean;
  failed: boolean;
}

/** What the timeline says about a download, if it has anything to say yet. */
const resourceOutcome = (pattern: RegExp | string): ResourceOutcome => {
  try {
    const entries = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
    const match = entries.find((entry) =>
      typeof pattern === 'string' ? entry.name.endsWith(pattern) : pattern.test(entry.name),
    );
    if (!match) return { seen: false, failed: false };

    // `responseStatus` is not in every browser, and is 0 for an opaque or
    // cross-origin response. Only a number that is plainly an error counts.
    const status = (match as PerformanceResourceTiming & { responseStatus?: number })
      .responseStatus;
    return { seen: true, failed: typeof status === 'number' && status >= 400 };
  } catch {
    return { seen: false, failed: false };
  }
};

const hasMark = (name: string): boolean => {
  try {
    return performance.getEntriesByName(name).length > 0;
  } catch {
    return false;
  }
};

/**
 * Progress through a route load, for the stage to render.
 *
 * `active` is false outside a load, so nothing is polled when there is nothing
 * to watch. `boatUrl` is the crew model the scene will ask for; it comes from
 * `crewModel.ts`, which is free of three and drei precisely so App can name the
 * file without pulling the 3D bundle in with it.
 */
export const useRouteLoadProgress = (active: boolean, boatUrl: string | null): LoadProgress => {
  // Phases only ever accumulate within a load. The scene clears and re-writes
  // its marks when a route is built a second time, and a bar that went
  // backwards because of that would be reporting the instrumentation rather
  // than the wait.
  const [phases, setPhases] = useState<{
    finished: ReadonlySet<LoadPhaseKey>;
    failed: ReadonlySet<LoadPhaseKey>;
  }>({ finished: new Set(), failed: new Set() });

  // React's own "adjust state when a prop changes" pattern, rather than a ref
  // read during render or a setState inside an effect body — both of which the
  // compiler rules reject, and rightly: the first can miss an update and the
  // second cascades renders.
  const [watching, setWatching] = useState(active);
  if (watching !== active) {
    setWatching(active);
    setPhases({ finished: new Set(), failed: new Set() });
  }

  // Only ever touched inside the effect and its callback, never during render.
  const startedAt = useRef<number | null>(null);

  useEffect(() => {
    if (!active) return;

    startedAt.current = Date.now();

    const read = () => {
      setPhases((current) => {
        const finished = new Set(current.finished);
        const failed = new Set(current.failed);

        if (!finished.has('view') && resourceOutcome(VIEW_CHUNK).seen) finished.add('view');
        if (!finished.has('scene') && hasMark(GEOMETRY_READY_MARK)) finished.add('scene');
        if (!finished.has('frame') && hasMark(FIRST_FRAME_MARK)) finished.add('frame');

        if (!finished.has('boat') && !failed.has('boat')) {
          const boat = boatUrl ? resourceOutcome(boatUrl) : { seen: false, failed: false };
          if (boat.failed) failed.add('boat');
          else if (boat.seen) finished.add('boat');
          else if (startedAt.current && Date.now() - startedAt.current > BOAT_GIVE_UP_MS) {
            failed.add('boat');
          }
        }

        // Same sizes means nothing settled, so hand back the object we were
        // given and let React skip the render.
        if (finished.size === current.finished.size && failed.size === current.failed.size) {
          return current;
        }
        return { finished, failed };
      });
    };

    const timer = setInterval(read, POLL_MS);
    return () => clearInterval(timer);
  }, [active, boatUrl]);

  return describeLoadProgress(phases.finished, phases.failed);
};
