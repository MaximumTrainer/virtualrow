import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import type * as THREE from 'three';
import { installCanvasMock } from './canvasMock';
import { SCENE_SCALE } from '../components/rower3d/constants';

/**
 * Issue #343 — the scene, mounted in a unit test.
 *
 * `vitest.config.ts` excluded `Rower3D.tsx` and every `rower3d/*.tsx` from
 * coverage, so the TDD guard never asked for a test for any of them. The
 * wrong-axis normal (#298) and the rower who never moved (#273) both lived in
 * that gap: they are facts about the scene graph, and nothing except a person
 * looking at the screen was checking them.
 *
 * Three things stand between Vitest and a mounted scene, and none of them is
 * the scene's own logic:
 *
 *  - `IS_TEST_MODE` is read once at module scope, so the automation flag has to
 *    be set before the scene module is imported. Without it `PMREMEnvironment`
 *    runs `PMREMGenerator.fromScene` against a renderer with no GL, three fails
 *    with "Invalid value used as weak map key", and `SceneErrorBoundary`
 *    swallows the entire scene.
 *  - drei's `Cloud` loads a sprite texture. It sits inside the skydome with no
 *    boundary of its own, so an unstubbed `Cloud` suspends everything and the
 *    renderer hands back an empty graph — which reads exactly like a broken
 *    scene.
 *  - `useGLTF` cannot even fail cleanly here: three's FileLoader hands jsdom's
 *    `AbortSignal` to Node's `fetch`, which rejects it as not an `AbortSignal`.
 *
 * Everything past that is the real thing: the real route curve, the real
 * lights, the real per-frame physics.
 */
vi.hoisted(() => {
  window.__PLAYWRIGHT_TESTING = true;
});

vi.mock('@react-three/drei', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@react-three/drei');
  const three = await vi.importActual<typeof THREE>('three');
  // `useGLTF` answers a list with a list: sceneryModels asks for every model a
  // route needs in one call, and a stub that always answers with one object
  // hands `undefined` to a <primitive>.
  const useGLTF = Object.assign(
    (path: string | string[]) =>
      Array.isArray(path)
        ? path.map(() => ({ scene: new three.Group() }))
        : { scene: new three.Group() },
    { preload: () => undefined },
  );
  return { ...actual, Cloud: () => null, useGLTF };
});

const { renderScene, demoRoute } = await import('./sceneTestRenderer');
const { BOAT_GROUP_NAME } = await import('../components/rower3d/constants');

/** 2:00/500m — 4.17 m/s, and a pace a test can do arithmetic on. */
const PACE_S_PER_500 = 120;

describe('RowerScene', () => {
  let uninstallCanvasMock: () => void;
  beforeAll(() => {
    uninstallCanvasMock = installCanvasMock();
  });
  afterAll(() => uninstallCanvasMock());

  // Every tier, because they do not build the same graph: `low` drops the
  // effect stack and the shadow-casting sun, and a tier that throws on mount is
  // a tier nobody discovers until a rower with that hardware opens the page.
  it.each(['low', 'auto', 'high'] as const)('builds a scene graph at %s', async (tier) => {
    const scene = await renderScene({ performanceMode: tier });

    const names = scene.objects().map((o) => o.name);
    expect(names, 'the scene never came out of Suspense').not.toContain('SceneSuspended');
    expect(scene.objects().length).toBeGreaterThan(20);
    expect(names).toContain(BOAT_GROUP_NAME);

    await scene.unmount();
  });

  // The one surviving theme dresses the scene, on a route named for it or
  // not: #361 retired the other five, so a route's name no longer decides
  // what it looks like.
  it('dresses the scene whatever the route is called', async () => {
    const scene = await renderScene({ route: { ...demoRoute, name: 'Leviathan Reach' } });

    const names = scene.objects().map((o) => o.name);
    expect(names, 'the scene never came out of Suspense').not.toContain('SceneSuspended');
    expect(names).toContain(BOAT_GROUP_NAME);

    await scene.unmount();
  });

  // The rower who never moved (#273) was exactly this: a scene that mounted,
  // rendered and sat still, with every Playwright spec passing because none of
  // them asked where the boat was a second later.
  it('rows the boat along the route as the frames go by', async () => {
    const scene = await renderScene({
      performanceMode: 'low',
      paceSPer500: PACE_S_PER_500,
      cadence: 30,
      isPlaying: true,
    });

    const boat = scene.objects().find((o) => o.name === BOAT_GROUP_NAME);
    expect(boat, 'no boat in the scene').toBeDefined();
    const start = boat!.position.clone();

    await scene.tick(120);

    // Stated in metres rather than in scene units, using the same constant the
    // scene builds its curve from. Two seconds at 2:00/500m is 8.3 m, and
    // saying so survives #321 rescaling the world: what changes there is how
    // many units a metre is, not how far a boat goes in two seconds.
    const metresTravelled = boat!.position.distanceTo(start) / SCENE_SCALE;

    expect(
      metresTravelled,
      'the boat did not cover the ground its pace says it should have',
    ).toBeGreaterThan(7);

    await scene.unmount();
  });

  // The low tier exists to cost less, and a shadow map is the most expensive
  // single thing the sun does. There are two directional lights by design - a
  // sun and a fill - so the fact worth asserting is which of them casts, not
  // how many there are.
  it.each([
    ['low', 0],
    ['auto', 1],
    ['high', 1],
  ] as const)('has %s shadow-casting sun(s) at that tier: %i', async (tier, casting) => {
    const scene = await renderScene({ performanceMode: tier });

    const suns = scene
      .objects()
      .filter((o): o is THREE.DirectionalLight => (o as THREE.DirectionalLight).isDirectionalLight);

    expect(suns.length, 'the scene lost a light').toBe(2);
    expect(suns.filter((s) => s.castShadow)).toHaveLength(casting);

    await scene.unmount();
  });
});
