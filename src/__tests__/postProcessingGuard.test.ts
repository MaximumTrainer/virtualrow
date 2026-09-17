import { describe, it, expect } from 'vitest';
import { canInitialisePostProcessing } from '../components/rower3d/postProcessingGuard';

/**
 * `postprocessing` dereferences `renderer.getContext().getContextAttributes().alpha`
 * unguarded in two places — EffectComposer.setRenderer and EffectComposer.addPass.
 * Either throws a TypeError when the context reports no attributes, which is
 * what a software rasteriser and a post-reset context both do (#197, #257).
 */

/** A renderer stand-in whose context answers however the test needs. */
const rendererWith = (attributes: unknown, opts: { throws?: boolean } = {}) => ({
  getContext: () => {
    if (opts.throws) throw new Error('context gone');
    return attributes === undefined
      ? null
      : { getContextAttributes: () => attributes };
  },
});

describe('canInitialisePostProcessing', () => {
  it('allows the composer when the context reports attributes', () => {
    expect(canInitialisePostProcessing(rendererWith({ alpha: true }))).toBe(true);
  });

  it('refuses when getContextAttributes returns null', () => {
    // The exact condition that throws inside addPass.
    expect(canInitialisePostProcessing(rendererWith(null))).toBe(false);
  });

  it('refuses when there is no context at all', () => {
    expect(canInitialisePostProcessing(rendererWith(undefined))).toBe(false);
  });

  it('refuses when asking for the context throws', () => {
    expect(canInitialisePostProcessing(rendererWith(null, { throws: true }))).toBe(false);
  });

  it('refuses a renderer that is missing entirely', () => {
    expect(canInitialisePostProcessing(null)).toBe(false);
    expect(canInitialisePostProcessing(undefined)).toBe(false);
  });

  it('re-reads the context every time it is asked', () => {
    // The old guard memoised on the renderer identity, so it answered once at
    // mount and never again. The renderer object does not change when its
    // context is lost, so a composer mounted while attributes were available
    // kept its verdict after they were gone — and addPass threw on the next
    // effect-list change (#257).
    let attributes: unknown = { alpha: true };
    const renderer = { getContext: () => ({ getContextAttributes: () => attributes }) };

    expect(canInitialisePostProcessing(renderer)).toBe(true);
    attributes = null;
    expect(canInitialisePostProcessing(renderer)).toBe(false);
  });
});
