// ============================================================================
// WEBGL CONTEXT SELECTION AND RECOVERY
//
// The scene asked for `powerPreference: 'high-performance'`, which on a hybrid
// laptop routes the context to the discrete GPU. When that adapter's driver
// refuses — `eglCreateContext: Requested version is not supported` — or the
// context is lost immediately, R3F never renders a frame, nothing throws, and
// the canvas is simply transparent: the container's background shows through
// and the rower is looking at a blank box with the workout still counting.
//
// So the configuration is probed before the real canvas is built, and the
// ladder gives up the discrete adapter, then multisampling, before it gives up
// rendering. Resolution and the models are never part of the trade: dpr is the
// caller's and nothing here proposes changing it.
// ============================================================================

import { describeUnmaskedRenderer } from '../../utils/gpuUtils';
import type { RenderCapabilities } from './sceneQuality';

export type PowerPreference = 'high-performance' | 'low-power' | 'default';

export interface AttemptResult {
  ok: boolean;
  /** The driver's own words, when it gave any. */
  reason?: string;
}

/** Tries to obtain a context with the given attributes. Injected, so it is testable. */
export type ContextAttempt = (options: WebGLContextAttributes) => AttemptResult;

export interface GlSelection {
  powerPreference: PowerPreference;
  antialias: boolean;
  /** False when no configuration worked; the caller should say so rather than show a blank. */
  usable: boolean;
  /** Why the preferred configuration was passed over. */
  fallbackReason?: string;
}

/**
 * Choose context attributes that this machine will actually grant.
 *
 * Ordered by what costs the rower least: the preferred adapter with
 * multisampling, then the adapter the browser is already using, then without
 * multisampling (post-processing can still antialias).
 */
export const selectGlOptions = (
  attempt: ContextAttempt,
  { preferred }: { preferred: { powerPreference: PowerPreference; antialias: boolean } },
): GlSelection => {
  // Each rung gives up one thing: first the adapter the tier asked for, then
  // multisampling. Never the resolution, and never the models.
  const rungs: Array<{ powerPreference: PowerPreference; antialias: boolean }> = [
    preferred,
    { powerPreference: 'default' as const, antialias: preferred.antialias },
    { powerPreference: 'default' as const, antialias: false },
  ];
  const ladder = rungs.filter(
    (rung, index, all) =>
      index === all.findIndex((r) => r.powerPreference === rung.powerPreference && r.antialias === rung.antialias),
  );

  let firstFailure: string | undefined;

  for (const [index, rung] of ladder.entries()) {
    const result = attempt({ ...rung, alpha: true, failIfMajorPerformanceCaveat: false });
    if (result.ok) {
      return {
        ...rung,
        usable: true,
        fallbackReason: index === 0 ? undefined : firstFailure,
      };
    }
    firstFailure ??= result.reason ?? 'the driver refused the context';
  }

  return {
    ...ladder[ladder.length - 1],
    usable: false,
    fallbackReason: firstFailure,
  };
};

/**
 * Probe a real context on a throwaway canvas, then drop it.
 *
 * `webglcontextcreationerror` carries the driver's explanation, which is the
 * difference between "the 3D view is blank" and a cause.
 */
export const browserContextAttempt: ContextAttempt = (options) => {
  if (typeof document === 'undefined') return { ok: false, reason: 'no document' };

  const canvas = document.createElement('canvas');
  let reason: string | undefined;
  const onError = (event: Event) => {
    reason = (event as Event & { statusMessage?: string }).statusMessage ?? undefined;
  };
  canvas.addEventListener('webglcontextcreationerror', onError);

  try {
    const context = canvas.getContext('webgl2', options) as WebGL2RenderingContext | null;
    if (!context) return { ok: false, reason: reason ?? 'no WebGL2 context' };

    // Hand the probe's context straight back rather than waiting for GC; a
    // machine tight enough to refuse one will not thank us for holding two.
    context.getExtension('WEBGL_lose_context')?.loseContext();
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: reason ?? (error as Error)?.message ?? 'context creation threw' };
  } finally {
    canvas.removeEventListener('webglcontextcreationerror', onError);
  }
};

/* --------------------------------------------------------- context state --- */

export interface ContextState {
  powerPreference: PowerPreference;
  antialias: boolean;
  /** Largest device pixel ratio the surface will draw at. */
  maxDpr?: number;
  /** True while the context is gone and the scene is not drawing. */
  lost: boolean;
  /** How many times it has been lost this session. */
  losses: number;
  lostReason?: string;
  fallbackReason?: string;
}

let state: ContextState | null = null;

export const recordContextCreated = (selection: {
  powerPreference: PowerPreference;
  antialias: boolean;
  maxDpr?: number;
  fallbackReason?: string;
}): void => {
  state = { ...selection, lost: false, losses: 0 };
};

export const recordContextLost = (reason?: string): void => {
  if (!state) return;
  state = { ...state, lost: true, losses: state.losses + 1, lostReason: reason };
};

export const recordContextRestored = (): void => {
  if (!state) return;
  state = { ...state, lost: false, lostReason: undefined };
};

export const readContextState = (): ContextState | null => state;

export const clearContextState = (): void => {
  state = null;
};

/* ------------------------------------------------------------- recovery --- */

/**
 * How long to wait before each attempt to get the context back.
 *
 * Not immediately: the WebGL spec lets the browser ignore a restore requested
 * from inside the `webglcontextlost` handler, and a driver that has just lost a
 * device is rarely ready to hand one straight back. Patience increases, and
 * then it stops — a scene that retries for ever is a scene that never explains
 * itself.
 */
export const RESTORE_DELAYS_MS = [300, 1500, 4000];

export type Scheduler = (callback: () => void, delayMs: number) => unknown;

/**
 * Ask for the context back, later, a few times.
 *
 * `isLost` is re-checked before each attempt so a context that came back on its
 * own (or through the browser) is left alone.
 */
export const scheduleContextRestore = (
  restore: () => void,
  isLost: () => boolean,
  schedule: Scheduler = setTimeout,
): void => {
  const attempt = (index: number) => {
    if (index >= RESTORE_DELAYS_MS.length) return;
    schedule(() => {
      if (!isLost()) return;
      restore();
      if (isLost()) attempt(index + 1);
    }, RESTORE_DELAYS_MS[index]);
  };
  attempt(0);
};

/* --------------------------------------------------------- capabilities --- */

/**
 * What the GPU can do, read from a throwaway context.
 *
 * The scene used to learn this only after the canvas existed, which was too
 * late to decide what kind of canvas to build (see sceneQuality.ts).
 */
/**
 * Memoised {@link selectGlOptions} against the real browser.
 *
 * Each attempt opens a context to see whether the driver grants it, so asking
 * repeatedly costs contexts for an answer that cannot change. selectGlOptions
 * itself stays injectable and uncached, because tests drive it with fakes and
 * must never be answered from another test's run (#261).
 */
const selectionCache = new Map<string, GlSelection>();

export const selectBrowserGlOptions = (
  preferred: { powerPreference: PowerPreference; antialias: boolean },
): GlSelection => {
  const key = `${preferred.powerPreference}:${preferred.antialias}`;
  const cached = selectionCache.get(key);
  if (cached) return cached;

  const selection = selectGlOptions(browserContextAttempt, { preferred });
  selectionCache.set(key, selection);
  return selection;
};

/**
 * Cached answer for {@link probeRenderCapabilities}.
 *
 * What the device can do does not change while the page is open, but every
 * probe opens a throwaway WebGL context — and a browser keeps only a handful
 * alive. Measured on the demo row before this cache existed: probeRender-
 * Capabilities ran four times and selectGlOptions four more, eleven contexts
 * for one scene, with the 3D view sitting behind "lost the graphics context —
 * restoring..." (#261).
 *
 * `undefined` means "not asked yet"; `null` is a real answer meaning "could
 * not probe", and must not cause a re-probe on every render.
 */
let cachedCapabilities: RenderCapabilities | null | undefined;

/** Forget the cached probe. For tests, so one never answers another. */
export const resetProbeCacheForTests = (): void => {
  cachedCapabilities = undefined;
  selectionCache.clear();
};

export const probeRenderCapabilities = (): RenderCapabilities | null => {
  if (cachedCapabilities !== undefined) return cachedCapabilities;
  if (typeof document === 'undefined') return null;

  const canvas = document.createElement('canvas');
  try {
    const context = canvas.getContext('webgl2') as WebGL2RenderingContext | null;
    if (!context) {
      cachedCapabilities = null;
      return cachedCapabilities;
    }

    cachedCapabilities = {
      maxTextureSize: context.getParameter(context.MAX_TEXTURE_SIZE) as number,
      renderer: describeUnmaskedRenderer(context),
    };
    context.getExtension('WEBGL_lose_context')?.loseContext();
    return cachedCapabilities;
  } catch {
    cachedCapabilities = null;
    return cachedCapabilities;
  }
};
