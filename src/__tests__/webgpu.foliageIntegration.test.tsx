import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import ReactThreeTestRenderer from '@react-three/test-renderer';
import { installCanvasMock } from './canvasMock';

/**
 * #498 Phase 2b integration: when `isWebGPUCullEnabled()` is false, the lazy
 * import of `src/webgpu/WebGPUFoliageCuller` never fires, so the module (and
 * `@webgpu/types` through it) stays out of the default bundle. When it is
 * true, the lazy import fires and the child mounts.
 *
 * Playwright (Phase 2c) covers the actual GPU dispatch; here we only pin the
 * import-boundary behaviour, which is CPU-only.
 */

vi.mock('../webgpu/WebGPUFoliageCuller', async () => {
  mockLoadCount += 1;
  return {
    WebGPUFoliageCuller: () => null,
  };
});

let mockLoadCount = 0;

const { BankFoliage } = await import('../components/rower3d/foliageComponents');

afterEach(() => {
  delete window.__VIRTUALROW_WEBGPU_CULL;
  mockLoadCount = 0;
});

const emptyCurve = new THREE.CatmullRomCurve3([
  new THREE.Vector3(0, 0, 0),
  new THREE.Vector3(1, 0, 0),
]);

describe('BankFoliage WebGPU lazy-import boundary (#498 Phase 2b)', () => {
  let uninstall: () => void;
  beforeAll(() => {
    uninstall = installCanvasMock();
  });
  afterAll(() => uninstall());

  it('does not load the WebGPU module when the flag is off', async () => {
    const positionRef = { current: new THREE.Vector3() };
    const renderer = await ReactThreeTestRenderer.create(
      <BankFoliage curve={emptyCurve} positionRef={positionRef} viewDistance={400} />,
    );
    // Give the lazy import time to settle if it had fired.
    await new Promise((r) => setTimeout(r, 10));
    expect(mockLoadCount).toBe(0);
    await renderer.unmount();
  });

  it('loads the WebGPU module when the flag is on', async () => {
    window.__VIRTUALROW_WEBGPU_CULL = true;
    const positionRef = { current: new THREE.Vector3() };
    const renderer = await ReactThreeTestRenderer.create(
      <BankFoliage curve={emptyCurve} positionRef={positionRef} viewDistance={400} />,
    );
    await new Promise((r) => setTimeout(r, 50));
    expect(mockLoadCount).toBeGreaterThan(0);
    await renderer.unmount();
  });
});
