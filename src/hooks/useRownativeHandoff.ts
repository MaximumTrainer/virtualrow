import { useEffect, useRef, useState } from 'react';
import { useServices } from '../context/ServicesContext';
import type { RoutePort } from '../ports';
import type { WaterRoute } from '../types/index';
import {
  clearHandoffParams,
  consumeHandoffState,
  isValidCourseId,
  readHandoffParams,
} from '../utils/rownativeHandoff';

export type HandoffStatus =
  | { kind: 'idle' }
  | { kind: 'loading'; courseId: string }
  | { kind: 'loaded'; route: WaterRoute }
  | { kind: 'error'; message: string };

type Resolution =
  | { kind: 'none' }
  | { kind: 'error'; message: string }
  | { kind: 'fetch'; courseId: string }
  | { kind: 'existing'; route: WaterRoute };

const EXPIRED_MESSAGE =
  'That rownative.icu link has expired. Open rownative.icu from VirtualRow and pick the course again.';
const INVALID_MESSAGE = 'That rownative.icu link carried an invalid course reference.';

/**
 * The URL is read, the nonce consumed and the address bar scrubbed exactly once
 * per page load. Memoised at module scope so React StrictMode's double-invoked
 * initialiser — and any remount — sees the same answer rather than burning the
 * single-use nonce on the first call and failing on the second.
 */
let cachedUrlResolution: Exclude<Resolution, { kind: 'existing' }> | undefined;

function resolveHandoffFromUrl(): Exclude<Resolution, { kind: 'existing' }> {
  if (cachedUrlResolution) return cachedUrlResolution;
  if (typeof window === 'undefined') return { kind: 'none' };

  const params = readHandoffParams(window.location.search);
  if (!params) {
    // Not cached: without handoff params there is nothing to consume, and a
    // later navigation in the same session may legitimately carry them.
    return { kind: 'none' };
  }

  // Consume the nonce and clean the URL before anything async, so a reload
  // mid-flight cannot replay the handoff.
  const stateOk = consumeHandoffState(params.state);
  const courseId = params.courseId.trim();
  clearHandoffParams();

  cachedUrlResolution = !stateOk
    ? { kind: 'error', message: EXPIRED_MESSAGE }
    : !isValidCourseId(courseId)
      ? { kind: 'error', message: INVALID_MESSAGE }
      : { kind: 'fetch', courseId };
  return cachedUrlResolution;
}

/** Test seam: forget the memoised read so each test starts from a clean URL. */
export function resetHandoffResolutionForTests(): void {
  cachedUrlResolution = undefined;
}

function resolve(routeService: RoutePort): { resolution: Resolution; status: HandoffStatus } {
  const fromUrl = resolveHandoffFromUrl();
  if (fromUrl.kind === 'none') return { resolution: fromUrl, status: { kind: 'idle' } };
  if (fromUrl.kind === 'error') {
    return { resolution: fromUrl, status: { kind: 'error', message: fromUrl.message } };
  }

  // Already imported in this session — re-select rather than duplicate.
  const existing = routeService.findRouteByRownativeId(fromUrl.courseId);
  if (existing) {
    return { resolution: { kind: 'existing', route: existing }, status: { kind: 'loaded', route: existing } };
  }
  return { resolution: fromUrl, status: { kind: 'loading', courseId: fromUrl.courseId } };
}

export interface UseRownativeHandoffOptions {
  /** Called with the route once a returned course has been resolved and imported. */
  onRouteLoaded: (route: WaterRoute) => void;
}

/**
 * Handles the return leg of the rownative.icu course handoff.
 *
 * If the app was opened with a course id in the URL, the accompanying state
 * nonce is validated, the id shape-checked, and the course resolved from the
 * public mirror and handed to `onRouteLoaded`.
 */
export function useRownativeHandoff({ onRouteLoaded }: UseRownativeHandoffOptions) {
  const { rownativeService, routeService } = useServices();
  const [initial] = useState(() => resolve(routeService));
  const [status, setStatus] = useState<HandoffStatus>(initial.status);

  // Held in a ref so an inline callback doesn't re-run the effect and import twice.
  const onRouteLoadedRef = useRef(onRouteLoaded);
  useEffect(() => {
    onRouteLoadedRef.current = onRouteLoaded;
  }, [onRouteLoaded]);

  const hasRunRef = useRef(false);

  useEffect(() => {
    const { resolution } = initial;
    if (resolution.kind === 'none' || resolution.kind === 'error') return;
    if (hasRunRef.current) return;
    hasRunRef.current = true;

    if (resolution.kind === 'existing') {
      onRouteLoadedRef.current(resolution.route);
      return;
    }

    // No cancellation flag here on purpose. `hasRunRef` already makes this a
    // once-per-page-load import, so a StrictMode cleanup-then-rerun would
    // otherwise cancel the only in-flight request and leave the UI stuck
    // showing "loading" forever, because the re-run is blocked by the guard.
    void rownativeService
      .importCourseById(resolution.courseId)
      .then((route) => {
        setStatus({ kind: 'loaded', route });
        onRouteLoadedRef.current(route);
      })
      .catch((e: unknown) => {
        setStatus({
          kind: 'error',
          message: e instanceof Error ? e.message : `Could not load rownative course ${resolution.courseId}.`,
        });
      });
  }, [initial, rownativeService]);

  return { status, dismiss: () => setStatus({ kind: 'idle' }) };
}
