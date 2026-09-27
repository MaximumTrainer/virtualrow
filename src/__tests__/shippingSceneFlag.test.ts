import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * `constants.ts` reads `window.__PLAYWRIGHT_TESTING` and
 * `window.__VIRTUALROW_SHIPPING_SCENE` at module load into `IS_TEST_MODE` and
 * again on every call for `wantsShippingScene()`. `IS_TEST_MODE` is frozen at
 * import time, so a test that changes it has to re-import the module.
 */
const loadConstants = async (opts: {
  playwright?: boolean;
  shipping?: boolean;
}): Promise<typeof import('../components/rower3d/constants')> => {
  if (opts.playwright) window.__PLAYWRIGHT_TESTING = true;
  else delete window.__PLAYWRIGHT_TESTING;
  if (opts.shipping) window.__VIRTUALROW_SHIPPING_SCENE = true;
  else delete window.__VIRTUALROW_SHIPPING_SCENE;
  vi.resetModules();
  return import('../components/rower3d/constants');
};

describe('wantsShippingScene / dropForCost (#419)', () => {
  beforeEach(() => {
    delete window.__PLAYWRIGHT_TESTING;
    delete window.__VIRTUALROW_SHIPPING_SCENE;
  });
  afterEach(() => {
    delete window.__PLAYWRIGHT_TESTING;
    delete window.__VIRTUALROW_SHIPPING_SCENE;
  });

  it('the shipping flag is off by default', async () => {
    const { wantsShippingScene } = await loadConstants({});
    expect(wantsShippingScene()).toBe(false);
  });

  it('the shipping flag reads the window opt-in', async () => {
    const { wantsShippingScene } = await loadConstants({ shipping: true });
    expect(wantsShippingScene()).toBe(true);
  });

  it('dropForCost is false outside automation', async () => {
    const { dropForCost } = await loadConstants({});
    expect(dropForCost()).toBe(false);
  });

  it('dropForCost is true under automation without the opt-in', async () => {
    const { dropForCost } = await loadConstants({ playwright: true });
    expect(dropForCost()).toBe(true);
  });

  it('dropForCost is false when the spec opts into the shipping scene', async () => {
    const { dropForCost } = await loadConstants({
      playwright: true,
      shipping: true,
    });
    expect(dropForCost()).toBe(false);
  });

  it('the opt-in outside automation stays false: nothing to lift', async () => {
    const { dropForCost } = await loadConstants({ shipping: true });
    expect(dropForCost()).toBe(false);
  });
});
