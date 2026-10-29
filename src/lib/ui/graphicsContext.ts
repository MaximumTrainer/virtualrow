/**
 * Context helper for the `GraphicsQualityStore` (#591-fu P2c).
 *
 * `+layout.svelte` instantiates the store once per session and passes it as a
 * prop to the DebugPanel; this context lets child routes (`/row` especially)
 * read the user's two-axis quality + distance choice without the layout
 * having to drill the whole thing down through props.
 */

import { getContext, setContext } from 'svelte';
import type { GraphicsQualityStore } from './graphicsQuality.svelte';

const KEY = Symbol('virtualrow:graphics-quality-store');

export const provideGraphicsStore = (store: GraphicsQualityStore): void => {
  setContext(KEY, store);
};

/**
 * Read the store from context. Returns `undefined` outside the provider so
 * callers in a smoke page or test can fall back to the device-probed tier.
 */
export const getGraphicsStore = (): GraphicsQualityStore | undefined =>
  getContext(KEY) as GraphicsQualityStore | undefined;
