/**
 * Whether a composer is actually mounted, as opposed to planned (#327).
 *
 * The tier decides whether to try, but `postprocessing` can refuse: where the
 * context reports no attributes the stack is dropped on purpose (#257), and
 * then ACES on the renderer is the right answer rather than a bug. Anything
 * asserting "exactly one stage grades the frame" has to know which of the two
 * actually happened, so it is recorded where it is decided.
 *
 * In its own module because `effectComponents.tsx` may export components only,
 * or fast refresh stops working for the whole file.
 */
let mounted = false;

export const recordComposerMounted = (value: boolean): void => {
  mounted = value;
};

export const readComposerMounted = (): boolean => mounted;
