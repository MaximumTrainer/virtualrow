import { useCallback, useEffect, useRef, useState } from 'react';
import { useServices } from '../context/useServices';
import type { WaterRoute } from '../types/index';

/** Query parameter that deep-links a rownative course into VirtualRow. */
export const DEEP_LINK_PARAM = 'rownativeCourseId';

export type DeepLinkStatus =
  | { kind: 'idle' }
  | { kind: 'loading'; courseId: string }
  | { kind: 'loaded'; route: WaterRoute }
  | { kind: 'error'; message: string; courseId: string };

/**
 * Read the deep-link course id and strip it from the URL.
 *
 * Runs at most once per page load — memoised at module scope so React
 * StrictMode's double-invoked initialiser, or any remount, sees the same answer
 * rather than reading a URL that has already been cleaned.
 */
let cachedCourseId: string | null | undefined;

function readAndStripCourseId(): string | null {
  if (cachedCourseId !== undefined) return cachedCourseId;
  if (typeof window === 'undefined') return null;

  const params = new URLSearchParams(window.location.search);
  const courseId = params.get(DEEP_LINK_PARAM);
  if (!courseId) {
    // Not memoised: a later navigation in this session may legitimately add one.
    return null;
  }

  params.delete(DEEP_LINK_PARAM);
  // Tolerate the nonce from links minted under the earlier redirect design.
  params.delete('state');
  const query = params.toString();
  window.history.replaceState(
    null,
    '',
    window.location.pathname + (query ? `?${query}` : '') + window.location.hash,
  );

  cachedCourseId = courseId;
  return courseId;
}

/** Test seam: forget the memoised read so each test starts from a clean URL. */
export function resetDeepLinkForTests(): void {
  cachedCourseId = undefined;
}

export interface UseRownativeDeepLinkOptions {
  /** Called with the route once the deep-linked course has been loaded. */
  onRouteLoaded: (route: WaterRoute) => void;
  /**
   * Whether the app is ready to import. A deep link that lands while auth is
   * still resolving is held in memory and imported once this turns true, so a
   * shared link survives a sign-in round trip (RS-5).
   */
  isReady?: boolean;
}

/**
 * Imports a rownative course named in the app URL, e.g.
 * `/app/?rownativeCourseId=5`.
 *
 * There is no state nonce: nothing redirects back into VirtualRow, so there is
 * no round trip to authenticate. The security property that matters is that the
 * fetch host is a hard-coded constant and the id is pattern-validated, so a
 * crafted link can never point the app at an arbitrary host.
 */
export function useRownativeDeepLink({ onRouteLoaded, isReady = true }: UseRownativeDeepLinkOptions) {
  const { rownativeService, routeService } = useServices();
  const [pendingCourseId] = useState(readAndStripCourseId);
  const [status, setStatus] = useState<DeepLinkStatus>(() =>
    pendingCourseId ? { kind: 'loading', courseId: pendingCourseId } : { kind: 'idle' },
  );

  const onRouteLoadedRef = useRef(onRouteLoaded);
  useEffect(() => {
    onRouteLoadedRef.current = onRouteLoaded;
  }, [onRouteLoaded]);

  const hasRunRef = useRef(false);

  useEffect(() => {
    if (!pendingCourseId || !isReady || hasRunRef.current) return;
    hasRunRef.current = true;

    // Already imported — select it rather than creating a duplicate. Resolved
    // through the same promise path as a fresh import so both outcomes settle
    // asynchronously and neither sets state synchronously inside the effect.
    const existing = routeService.findRouteByRownativeId(pendingCourseId);
    const load = existing
      ? Promise.resolve(existing)
      : rownativeService.importCourseById(pendingCourseId);

    // No cancellation on cleanup: `hasRunRef` already makes this a once-per-load
    // import, so cancelling on a StrictMode cleanup would abandon the only
    // in-flight request and leave the UI stuck on "loading".
    void load
      .then((route) => {
        setStatus({ kind: 'loaded', route });
        onRouteLoadedRef.current(route);
      })
      .catch((e: unknown) => {
        setStatus({
          kind: 'error',
          courseId: pendingCourseId,
          message: e instanceof Error ? e.message : `Could not load rownative course ${pendingCourseId}.`,
        });
      });
  }, [pendingCourseId, isReady, rownativeService, routeService]);

  const dismiss = useCallback(() => setStatus({ kind: 'idle' }), []);
  return { status, dismiss };
}
