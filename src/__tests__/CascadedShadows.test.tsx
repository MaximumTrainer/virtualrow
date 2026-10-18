import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as THREE from 'three';
import ReactThreeTestRenderer from '@react-three/test-renderer';
import { installCanvasMock } from './canvasMock';

/**
 * Issue #495 — Cascaded Shadow Maps mount under the main camera and clean up
 * on unmount so a tier change doesn't leak directional lights.
 *
 * Phase 1 only checks the plumbing is right. Phase 2 adds the visual AC
 * (`csm.setupMaterial` on the shadow-receiving materials) and the baseline
 * re-record, so the fragment-shader side of CSM is not asserted here.
 */

const { CascadedShadows } = await import('../components/rower3d/CascadedShadows');
const { createCascadedShadows } = await import('../components/rower3d/cascadedShadowsCore');

describe('CascadedShadows', () => {
  let uninstallCanvasMock: () => void;
  beforeAll(() => {
    uninstallCanvasMock = installCanvasMock();
  });
  afterAll(() => uninstallCanvasMock());

  const defaults = {
    cascades: 3,
    shadowMapSize: 1024,
    lightDirection: new THREE.Vector3(-1, -1, -1).normalize(),
    lightColor: '#ffeec0' as const,
    lightIntensity: 2.2,
    maxFar: 400,
  };

  it('creates one directional light per cascade and parents them to the scene', async () => {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 500);
    const csm = createCascadedShadows(camera, scene, { ...defaults, cascades: 3 });
    expect(csm.lights).toHaveLength(3);
    for (const light of csm.lights) {
      expect(light).toBeInstanceOf(THREE.DirectionalLight);
      expect(light.castShadow).toBe(true);
      expect(light.color.getHex()).toBe(new THREE.Color('#ffeec0').getHex());
    }
    csm.remove();
    csm.dispose();
  });

  it('sets each cascade\'s shadow map size from the surface config', async () => {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 500);
    const csm = createCascadedShadows(camera, scene, { ...defaults, cascades: 4, shadowMapSize: 2048 });
    for (const light of csm.lights) {
      expect(light.shadow.mapSize.width).toBe(2048);
      expect(light.shadow.mapSize.height).toBe(2048);
    }
    csm.remove();
    csm.dispose();
  });

  it('mounts under R3F and disposes its lights on unmount', async () => {
    const renderer = await ReactThreeTestRenderer.create(<CascadedShadows {...defaults} />);
    const scene = renderer.scene.instance as unknown as THREE.Scene;
    // Give the mount useEffect a tick to run.
    await ReactThreeTestRenderer.act(async () => {
      await renderer.advanceFrames(1, 1 / 60);
    });
    const directionals = (): THREE.DirectionalLight[] => {
      const found: THREE.DirectionalLight[] = [];
      scene.traverse((o) => {
        if ((o as THREE.DirectionalLight).isDirectionalLight) found.push(o as THREE.DirectionalLight);
      });
      return found;
    };
    expect(directionals().length).toBe(defaults.cascades);
    await renderer.unmount();
    expect(directionals().length).toBe(0);
  });
});
