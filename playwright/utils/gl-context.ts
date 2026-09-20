import type { Page } from '@playwright/test';

/**
 * Losing and restoring the scene's graphics context, on purpose.
 *
 * Chrome honours `restoreContext()` only from the extension instance that
 * called `loseContext()`, and drops the extension afterwards. A spec that
 * fetches the extension twice therefore cannot put the context back, which is
 * why webgl-context-recovery.spec.ts declared the resume path untestable and
 * covered it with unit tests instead.
 *
 * So the instance is kept on the page between the two calls. That, plus waiting
 * for the app's own retry schedule to finish before asking, is what makes the
 * resume deterministic rather than a coin toss (#309).
 */

declare global {
  interface Window {
    /** The extension instance that took the context away. */
    __TEST_GL_LOSE_EXT?: { loseContext: () => void; restoreContext: () => void } | null;
    /** Every getContext call this page made, for the budget check. */
    __TEST_CTX_LOG?: Array<{ type: string; at: number; created: boolean }>;
  }
}

/** Take the scene's context away, keeping hold of the thing that can give it back. */
export const loseContext = (page: Page): Promise<boolean> =>
  page.evaluate(() => {
    const canvas = document.querySelector(
      '.rower3d-canvas-container canvas',
    ) as HTMLCanvasElement | null;
    const gl = canvas?.getContext('webgl2') as WebGL2RenderingContext | null;
    const ext = gl?.getExtension('WEBGL_lose_context') ?? null;
    window.__TEST_GL_LOSE_EXT = ext;
    if (!ext) return false;
    ext.loseContext();
    return true;
  });

/**
 * Give it back, from the same instance that took it.
 *
 * Only call this once the app's own schedule has run out — RESTORE_DELAYS_MS
 * sums to about 5.8 s — or the app's `forceContextRestore` races this one and
 * the spec passes about half the time.
 */
export const restoreContext = (page: Page): Promise<boolean> =>
  page.evaluate(() => {
    const ext = window.__TEST_GL_LOSE_EXT;
    if (!ext) return false;
    ext.restoreContext();
    return true;
  });

/**
 * Count every WebGL context this page opens, from before it opens any.
 *
 * Installed as an init script and calls through. It must never create a context
 * of its own: `getContext` is a constructor, not a question, and a guard that
 * makes the context it audits is the fault #261 and `12eafda` both fixed.
 *
 * Calls are recorded, but only the *first* call for a given canvas and type is
 * marked `created`. That distinction is the whole measurement. A browser evicts
 * the oldest context when a new one is **created**, and asking a canvas that
 * already has one returns the same object and evicts nothing — so counting
 * calls answers a different and much less interesting question. Measured: this
 * spec reported six webgl2 "contexts" where four had been created, because
 * `expectSceneAlive` asks each canvas whether its context is lost, and
 * RouteMap re-asks its own canvas for a 2D context about once a second.
 */
export const countContextsFrom = (page: Page): Promise<void> =>
  page.addInitScript(() => {
    window.__TEST_CTX_LOG = [];
    const seen = new WeakMap<HTMLCanvasElement, Set<string>>();
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (
      this: HTMLCanvasElement,
      ...args: Parameters<typeof original>
    ) {
      try {
        const type = String(args[0]);
        let types = seen.get(this);
        if (!types) {
          types = new Set<string>();
          seen.set(this, types);
        }
        const created = !types.has(type);
        types.add(type);
        window.__TEST_CTX_LOG?.push({ type, at: performance.now(), created });
      } catch {
        /* intentional */
      }
      return (original as (...a: unknown[]) => unknown).apply(this, args);
    } as typeof original;
  });

/** Every getContext call so far, whatever the type and whether or not it made one. */
export const allContexts = (page: Page): Promise<Array<{ type: string; at: number; created: boolean }>> =>
  page.evaluate(() => window.__TEST_CTX_LOG ?? []);

/**
 * The webgl2 contexts actually *created*, in the order they were made.
 *
 * Repeat calls on a canvas that already has one are left out; see
 * {@link countContextsFrom} for why that is the measurement that matters.
 */
export const webglContexts = (page: Page): Promise<Array<{ type: string; at: number; created: boolean }>> =>
  page.evaluate(() =>
    (window.__TEST_CTX_LOG ?? []).filter((entry) => entry.type === 'webgl2' && entry.created),
  );

/** The scene's own view of its context: lost or not, and how often. */
export const contextState = (page: Page) =>
  page.evaluate(() => window.__ROWER3D_CONTEXT_STATE ?? null);

/** Draw calls only advance while the scene is actually rendering. */
export const drawCalls = (page: Page): Promise<number> =>
  page.evaluate(() => window.__ROWER3D_RENDER_STATS?.drawCalls ?? 0);

/** The banner text the rower can see, or '' when there is none. */
export const bannerText = (page: Page): Promise<string> =>
  page.evaluate(() => {
    const marker = document.querySelector('.rower3d-fallback-marker') as HTMLElement | null;
    return marker && marker.style.display !== 'none' ? (marker.textContent ?? '') : '';
  });

/** The scene telemetry log as it stands, oldest first. */
export const telemetry = (page: Page): Promise<Array<{ kind: string; detail?: Record<string, unknown> }>> =>
  page.evaluate(() => {
    try {
      const raw = sessionStorage.getItem('virtualrow:scene-telemetry');
      return raw ? (JSON.parse(raw) as Array<{ kind: string; detail?: Record<string, unknown> }>) : [];
    } catch {
      return [];
    }
  });
