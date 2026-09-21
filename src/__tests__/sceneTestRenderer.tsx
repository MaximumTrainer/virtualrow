import { Suspense } from 'react';
import ReactThreeTestRenderer from '@react-three/test-renderer';
import type * as THREE from 'three';
import { RowerScene } from '../components/Rower3D';
import { routeService } from '../services/routeService';
import type { Rower3DProps } from '../components/Rower3D';

/**
 * Mount the R3F scene in Vitest, with no WebGL and no downloads (#343).
 *
 * `vitest.config.ts` excludes `Rower3D.tsx` and every `rower3d/*.tsx` from
 * coverage, which means the TDD guard has never required a test for any of
 * them. The wrong-axis normal (#298), the rower who never moved (#273) and the
 * three-scales-at-once world (#321) all lived in that gap: they are scene-graph
 * facts, and nothing but a person looking at the screen was checking them.
 *
 * A spec using this must stub the scene's two downloads first — see
 * `rowerScene.smoke.test.tsx`, which explains what each one is and why it
 * cannot simply be left to fail. Everything else is the real thing: the real
 * curve, the real lights, the real per-frame physics.
 */

/** The built-in demo route, which every scene test rows. */
export const demoRoute = routeService.getAllRoutes()[0];

export const renderScene = async (props: Partial<Rower3DProps> = {}) => {
  const renderer = await ReactThreeTestRenderer.create(
    <Suspense fallback={<group name="SceneSuspended" />}>
      <RowerScene route={demoRoute} gpuBackend="webgl" performanceMode="low" {...props} />
    </Suspense>,
  );

  /** Every object in the graph, so a test can ask what the scene contains. */
  const objects = (): THREE.Object3D[] => {
    const found: THREE.Object3D[] = [];
    renderer.scene.instance.traverse((o) => found.push(o));
    return found;
  };

  return {
    renderer,
    objects,
    /** Advance the scene clock, running every `useFrame` callback. */
    tick: async (frames = 1, delta = 1 / 60) => {
      await ReactThreeTestRenderer.act(async () => {
        await renderer.advanceFrames(frames, delta);
      });
    },
    unmount: () => renderer.unmount(),
  };
};

export type SceneUnderTest = Awaited<ReturnType<typeof renderScene>>;
