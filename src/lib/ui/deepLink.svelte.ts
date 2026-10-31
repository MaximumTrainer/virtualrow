/**
 * The rownative deep-link runner (#542 P1 — a Svelte-runes port of
 * `useRownativeDeepLink`).
 *
 * Opening the app with `/app/?rownativeCourseId=<id>` imports that course and
 * selects it. There is no state nonce: nothing redirects back into VirtualRow,
 * so there is no round trip to authenticate. The security property that matters
 * is that the fetch host is a hard-coded constant and the id is
 * pattern-validated, so a crafted link can never point the app at an arbitrary
 * host.
 *
 * The shell creates one runner, provides it, and drives {@link run} from an
 * effect as auth resolves; the Row screen reads {@link status} for the handoff
 * banner. Services are injected (defaulting to the production bundle).
 */
import type { Services } from '../ports';
import type { WaterRoute } from '../types/index';
import { defaultServices } from './services';

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
 * Runs at most once per page load — memoised at module scope so a remount sees
 * the same answer rather than reading a URL that has already been cleaned.
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

export class RownativeDeepLinkRunner {
  #rownativeService: Services['rownativeService'];
  #routeService: Services['routeService'];
  #pendingCourseId: string | null;
  #hasRun = false;

  status = $state<DeepLinkStatus>({ kind: 'idle' });

  constructor(services: Services = defaultServices) {
    this.#rownativeService = services.rownativeService;
    this.#routeService = services.routeService;
    this.#pendingCourseId = readAndStripCourseId();
    if (this.#pendingCourseId) {
      this.status = { kind: 'loading', courseId: this.#pendingCourseId };
    }
  }

  /**
   * Import the deep-linked course once the app is ready, then hand the route to
   * `onRouteLoaded`. Idempotent: a deep link that lands while auth is still
   * resolving is imported the first time `ready` turns true (RS-5). Safe to call
   * from a reactive effect.
   */
  run(ready: boolean, onRouteLoaded: (route: WaterRoute) => void): void {
    const courseId = this.#pendingCourseId;
    if (!courseId || !ready || this.#hasRun) return;
    this.#hasRun = true;

    // Already imported — select it rather than creating a duplicate.
    const existing = this.#routeService.findRouteByRownativeId(courseId);
    const load = existing
      ? Promise.resolve(existing)
      : this.#rownativeService.importCourseById(courseId);

    void load
      .then((route) => {
        this.status = { kind: 'loaded', route };
        onRouteLoaded(route);
      })
      .catch((e: unknown) => {
        this.status = {
          kind: 'error',
          courseId,
          message:
            e instanceof Error ? e.message : `Could not load rownative course ${courseId}.`,
        };
      });
  }

  dismiss(): void {
    this.status = { kind: 'idle' };
  }
}
