import { describe, it, expect, afterEach } from 'vitest';
import { readComposerMounted, recordComposerMounted } from '../components/rower3d/composerState';

/**
 * Issue #327 — which of the two stages actually graded the frame.
 *
 * The tier decides whether to try mounting a composer, but `postprocessing` can
 * refuse: where the context reports no attributes the stack is dropped on
 * purpose (#257), and ACES on the renderer is then the right answer rather than
 * a bug. A spec asserting "exactly one stage grades the frame" has to be able
 * to tell those apart, and the tier alone cannot — which is the mistake this
 * module exists to stop being made again.
 */
describe('composerState', () => {
  afterEach(() => recordComposerMounted(false));

  it('reports nothing mounted before anything mounts', () => {
    expect(readComposerMounted()).toBe(false);
  });

  it('remembers that a composer went up', () => {
    recordComposerMounted(true);
    expect(readComposerMounted()).toBe(true);
  });

  it('forgets it again when the composer comes down', () => {
    recordComposerMounted(true);
    recordComposerMounted(false);

    expect(
      readComposerMounted(),
      'a torn-down composer still counted, so the renderer would look wrong',
    ).toBe(false);
  });
});
