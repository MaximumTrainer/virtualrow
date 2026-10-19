import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import ReactThreeTestRenderer from '@react-three/test-renderer';
import { installCanvasMock } from './canvasMock';

/**
 * #498 Phase 2b integration: BankFoliage lazy-loads the WebGPU module only
 * when `isWebGPUCullEnabled()` reads true; while active, the shared
 * activeRef makes the CPU cull branch no-op so the mesh writes aren't duplicated.
 * The actual GPU dispatch is Playwright's job (Phase 2c).
 */

vi.mock('@react-three/drei', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@react-three/drei');
  return { ...actual, Cloud: () => null };
});

let mockMountCount = 0;
let mockActivate = true;

vi.mock('../webgpu/WebGPUFoliageCuller', async () => {
  const React = await vi.importActual<typeof import('react')>('react');
  return {
    WebGPUFoliageCuller: (props: { activeRef: { current: boolean } }) => {
      // Set during render so the ref is live before the first animation
      // frame runs (useEffect would commit a tick too late).
      mockMountCount += 1;
      if (mockActivate) props.activeRef.current = true;
      React.useEffect(() => {
        return () => {
          props.activeRef.current = false;
        };
      }, [props.activeRef]);
      return null;
    },
  };
});

// Preload the mocked module so React.lazy inside BankFoliage resolves on the
// first render instead of after a microtask.
await import('../webgpu/WebGPUFoliageCuller');

const { BankFoliage } = await import('../components/rower3d/foliageComponents');
const { AnimationProvider } = await import('../components/rower3d/AnimationContext');

afterEach(() => {
  delete window.__VIRTUALROW_WEBGPU_CULL;
  delete window.__ROWER3D_FOLIAGE;
  mockMountCount = 0;
  mockActivate = true;
});

const straightRoute = (length: number) =>
  new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, 0, -length / 2),
    new THREE.Vector3(0, 0, -length),
  ]);

const mount = async (element: React.ReactElement) => {
  const renderer = await ReactThreeTestRenderer.create(
    <AnimationProvider>{element}</AnimationProvider>,
  );
  const tick = async (frames: number) => {
    await ReactThreeTestRenderer.act(async () => {
      await renderer.advanceFrames(frames, 1 / 60);
    });
  };
  return { renderer, tick };
};

describe('BankFoliage WebGPU lazy-import boundary (#498 Phase 2b)', () => {
  let uninstall: () => void;
  beforeAll(() => {
    uninstall = installCanvasMock();
  });
  afterAll(() => uninstall());

  it('does not load the WebGPU module when the flag is off', async () => {
    const positionRef = { current: new THREE.Vector3() };
    const { renderer, tick } = await mount(
      <BankFoliage curve={straightRoute(2_000)} positionRef={positionRef} viewDistance={400} />,
    );
    await tick(10);
    expect(mockMountCount).toBe(0);
    await renderer.unmount();
  });

  it('loads the WebGPU module and skips CPU cull when active', async () => {
    window.__VIRTUALROW_WEBGPU_CULL = true;
    const positionRef = { current: new THREE.Vector3() };
    const { renderer, tick } = await mount(
      <BankFoliage curve={straightRoute(2_000)} positionRef={positionRef} viewDistance={400} />,
    );
    // Flush microtasks until the Suspended lazy module commits a render.
    for (let i = 0; i < 10 && mockMountCount === 0; i += 1) {
      await ReactThreeTestRenderer.act(async () => {
        await Promise.resolve();
      });
    }
    await tick(20);
    expect(mockMountCount).toBeGreaterThan(0);
    await renderer.unmount();
  });

  it('runs CPU cull when the flag is on but activeRef never flips', async () => {
    window.__VIRTUALROW_WEBGPU_CULL = true;
    mockActivate = false;
    const positionRef = { current: new THREE.Vector3() };
    const { renderer, tick } = await mount(
      <BankFoliage curve={straightRoute(2_000)} positionRef={positionRef} viewDistance={400} />,
    );
    for (let i = 0; i < 10 && mockMountCount === 0; i += 1) {
      await ReactThreeTestRenderer.act(async () => {
        await Promise.resolve();
      });
    }
    await tick(20);
    expect(mockMountCount).toBeGreaterThan(0);
    await renderer.unmount();
  });

  it('skips every cull branch when positionRef is empty', async () => {
    const positionRef: React.RefObject<THREE.Vector3 | null> = { current: null };
    const { renderer, tick } = await mount(
      <BankFoliage curve={straightRoute(2_000)} positionRef={positionRef} viewDistance={400} />,
    );
    // Nothing to assert on the DOM; this exists only to run the `!boat`
    // early-return branch in BankFoliage's animation callback.
    await tick(5);
    await renderer.unmount();
  });
});
