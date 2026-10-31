/**
 * The rownative deep-link runner over Svelte context (#542 P1).
 *
 * The shell (`+layout.svelte`) creates one {@link RownativeDeepLinkRunner},
 * provides it, and drives it as auth resolves; the Row screen reads it with
 * {@link getDeepLink} for the handoff banner. Mirrors the other UI contexts.
 */
import { getContext, setContext } from 'svelte';
import { RownativeDeepLinkRunner } from './deepLink.svelte';

const DEEP_LINK_KEY = Symbol('virtualrow.deepLink');

/** Provide a deep-link runner to the subtree. Returns it for the caller. */
export function setDeepLink(
  runner: RownativeDeepLinkRunner = new RownativeDeepLinkRunner(),
): RownativeDeepLinkRunner {
  setContext(DEEP_LINK_KEY, runner);
  return runner;
}

/** Read the provided deep-link runner. Throws if the shell did not provide one. */
export function getDeepLink(): RownativeDeepLinkRunner {
  const runner = getContext<RownativeDeepLinkRunner | undefined>(DEEP_LINK_KEY);
  if (!runner) {
    throw new Error('getDeepLink() called with no RownativeDeepLinkRunner in context');
  }
  return runner;
}
