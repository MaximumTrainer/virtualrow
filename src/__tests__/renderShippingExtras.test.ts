import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * #419: `RENDER_SHIPPING_EXTRAS` decides whether the scene draws the costly
 * extras a rower gets (PMREM, water mirror, wake, contact shadow, GLB scull).
 * It is a module-load constant, so a test that toggles it has to re-import the
 * module after seeding `window`.
 */

describe('RENDER_SHIPPING_EXTRAS (#419)', () => {
  const originalPlaywright = window.__PLAYWRIGHT_TESTING;
  const originalShipping = window.__VIRTUALROW_SHIPPING_SCENE;

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    window.__PLAYWRIGHT_TESTING = originalPlaywright;
    window.__VIRTUALROW_SHIPPING_SCENE = originalShipping;
  });

  const loadFlag = async () => {
    const mod = await import('../components/rower3d/constants');
    return { RENDER_SHIPPING_EXTRAS: mod.RENDER_SHIPPING_EXTRAS, IS_TEST_MODE: mod.IS_TEST_MODE };
  };

  it('renders the shipping extras outside automation (a real user)', async () => {
    delete window.__PLAYWRIGHT_TESTING;
    delete window.__VIRTUALROW_SHIPPING_SCENE;
    const { RENDER_SHIPPING_EXTRAS, IS_TEST_MODE } = await loadFlag();
    expect(IS_TEST_MODE).toBe(false);
    expect(RENDER_SHIPPING_EXTRAS).toBe(true);
  });

  it('skips them by default under Playwright automation', async () => {
    window.__PLAYWRIGHT_TESTING = true;
    delete window.__VIRTUALROW_SHIPPING_SCENE;
    const { RENDER_SHIPPING_EXTRAS, IS_TEST_MODE } = await loadFlag();
    expect(IS_TEST_MODE).toBe(true);
    expect(RENDER_SHIPPING_EXTRAS).toBe(false);
  });

  it('renders them under automation when the spec asks (AC2.1)', async () => {
    window.__PLAYWRIGHT_TESTING = true;
    window.__VIRTUALROW_SHIPPING_SCENE = true;
    const { RENDER_SHIPPING_EXTRAS, IS_TEST_MODE } = await loadFlag();
    expect(IS_TEST_MODE).toBe(true);
    expect(RENDER_SHIPPING_EXTRAS).toBe(true);
  });

  it('a falsy shipping flag is treated as absent (AC2.3)', async () => {
    window.__PLAYWRIGHT_TESTING = true;
    window.__VIRTUALROW_SHIPPING_SCENE = false;
    const { RENDER_SHIPPING_EXTRAS } = await loadFlag();
    expect(RENDER_SHIPPING_EXTRAS).toBe(false);
  });

  it('has no effect outside automation — a real user always gets the extras', async () => {
    delete window.__PLAYWRIGHT_TESTING;
    window.__VIRTUALROW_SHIPPING_SCENE = false;
    const { RENDER_SHIPPING_EXTRAS } = await loadFlag();
    expect(RENDER_SHIPPING_EXTRAS).toBe(true);
  });
});
