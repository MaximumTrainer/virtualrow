// ============================================================================
// CAN THE EFFECT COMPOSER SAFELY INITIALISE?
//
// `postprocessing` reads `renderer.getContext().getContextAttributes().alpha`
// in two places — EffectComposer.setRenderer and EffectComposer.addPass — and
// guards neither. `getContextAttributes()` returns null when the context is
// lost or was never validly created, which a software rasteriser and a
// post-GPU-reset context both do, so either call throws a TypeError (#197).
//
// The original guard asked this once, in a useMemo keyed on the renderer. The
// renderer object does not change when its context goes, so the answer went
// stale: a composer that mounted while attributes were available kept its
// verdict afterwards, and the next effect-list change reached addPass and threw
// anyway. That is #257 — errors at auto and high with no god rays involved and
// no context loss reported.
//
// Asking every render is cheap — two property reads — and is the difference
// between a stale answer and a true one.
// ============================================================================

interface ContextLike {
  getContextAttributes?: () => unknown;
}

interface RendererLike {
  getContext?: () => ContextLike | null | undefined;
}

/**
 * Whether the composer can be built against this renderer right now.
 *
 * Deliberately not memoised by the caller: the whole point is that the answer
 * changes underneath a renderer whose identity has not.
 */
export const canInitialisePostProcessing = (renderer: unknown): boolean => {
  const candidate = renderer as RendererLike | null | undefined;
  if (!candidate || typeof candidate.getContext !== 'function') return false;

  try {
    const context = candidate.getContext();
    if (!context || typeof context.getContextAttributes !== 'function') return false;
    return context.getContextAttributes() != null;
  } catch {
    // A renderer that throws when asked for its context cannot host a composer.
    return false;
  }
};
