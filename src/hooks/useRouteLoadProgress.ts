import { useEffect, useState } from 'react';
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

/**
 * How long to wait for the boat before calling it lost.
 *
 * A backstop, not a clock. The bar's *value* only ever moves when a phase
 * settles — this decides when an outstanding phase has settled as `failed`,
 * which is a different question.
 *
 * Deliberately far longer than any load anyone has measured. It was 20 s, on
 * the strength of a 3.2 s local load, and CI then measured the same load taking
 * **15.3 s and 17.0 s** on the macOS runner — three seconds of margin before
 * the app would have told a rower their boat was missing while it was still
 * arriving. A rower on a slow connection fetching 1.9 MB has no reason to be
 * treated better than a CI runner, and the asymmetry here is stark: waiting too
 * long leaves a progress bar up, and giving up too early is a lie about their
 * boat.
 *
 * A real failure does not wait for this. Chrome records a resource entry with
 * `responseStatus` for a 503, and that path settles immediately.
 */
const BOAT_GIVE_UP_MS = 60_000;

/** Whether a resource entry is one that plainly failed. */
const entryFailed = (entry: PerformanceEntry): boolean => {
  // `responseStatus` is not in every browser, and is 0 for an opaque or
  // cross-origin response. Only a number that is plainly an error counts.
  const status = (entry as PerformanceResourceTiming & { responseStatus?: number })
    .responseStatus;
  return typeof status === 'number' && status >= 400;
};

/**
 * Progress through a route load, for the stage to render.
 *
 * `active` is false outside a load, so nothing is watched when there is nothing
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

  useEffect(() => {
    if (!active) return;

    /**
     * Pushed new entries, rather than rescanning every entry on a timer.
     *
     * This polled `getEntriesByType('resource')` ten times a second, which is
     * a scan of every resource the page has ever fetched — and the scenery kit
     * fetches hundreds of models. On the macOS runner, the slowest machine in
     * the matrix, that was enough main-thread work alongside a software
     * rasteriser to push `scenery-kit-budgets` past its 30 s budget for the
     * route curve to exist at all. An observer costs nothing per entry and
     * nothing at all once it is disconnected.
     *
     * It also cannot miss what polling could: `markRouteLoadStart` clears the
     * marks when a route is rebuilt, so a geometry mark written and cleared
     * between two polls was invisible. An observer is told when it happens.
     */
    const settle = (mutate: (finished: Set<LoadPhaseKey>, failed: Set<LoadPhaseKey>) => void) => {
      setPhases((current) => {
        const finished = new Set(current.finished);
        const failed = new Set(current.failed);
        mutate(finished, failed);
        if (finished.size === current.finished.size && failed.size === current.failed.size) {
          return current;
        }
        return { finished, failed };
      });
    };

    const consider = (entries: PerformanceEntryList) => {
      settle((finished, failed) => {
        for (const entry of entries) {
          if (entry.entryType === 'mark') {
            if (entry.name === GEOMETRY_READY_MARK) finished.add('scene');
            if (entry.name === FIRST_FRAME_MARK) finished.add('frame');
            continue;
          }
          if (VIEW_CHUNK.test(entry.name)) finished.add('view');
          if (boatUrl && entry.name.endsWith(boatUrl)) {
            if (entryFailed(entry)) failed.add('boat');
            else finished.add('boat');
          }
        }
      });
    };

    let observer: PerformanceObserver | null = null;
    try {
      observer = new PerformanceObserver((list) => consider(list.getEntries()));
      // `buffered` matters: the chunk and the marks can both land before this
      // effect runs, and a bar that missed them would sit at 0 until the boat.
      observer.observe({ type: 'resource', buffered: true });
      observer.observe({ type: 'mark', buffered: true });
    } catch {
      // No PerformanceObserver, or an entry type it will not take. The bar
      // degrades to showing nothing rather than taking the page down.
      observer = null;
    }

    const giveUp = setTimeout(() => {
      settle((finished, failed) => {
        if (!finished.has('boat')) failed.add('boat');
      });
    }, BOAT_GIVE_UP_MS);

    return () => {
      observer?.disconnect();
      clearTimeout(giveUp);
    };
  }, [active, boatUrl]);

  return describeLoadProgress(phases.finished, phases.failed);
};
