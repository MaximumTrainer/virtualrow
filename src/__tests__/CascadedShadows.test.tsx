import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as THREE from 'three';
import ReactThreeTestRenderer from '@react-three/test-renderer';
import { installCanvasMock } from './canvasMock';

/**
 * Issue #495 — Cascaded Shadow Maps mount under the main camera and clean up
 * on unmount so a tier change doesn't leak directional lights.
 *
 * Phase 2 wires `csm.setupMaterial` onto every shadow-receiving material,
 * preserving each material's own `onBeforeCompile` by chaining the callbacks.
 */

const { CascadedShadows } = await import('../components/rower3d/CascadedShadows');
const { wireShadowReceivers, unwireShadowReceivers } = await import(
  '../components/rower3d/shadowReceivers'
);
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

/**
 * #495 Phase 2 — the point of CSM is that every shadow-receiving material
 * samples from the cascade stack, not from the single-map `DirectionalLight`.
 * three's `csm.setupMaterial` does the shader injection, but it OVERWRITES
 * `material.onBeforeCompile`, so a material with its own (bankMaterial.ts
 * triplanar chain, water, boat) silently loses its chunks the moment CSM
 * touches it. The wiring preserves the original callback and runs both.
 */
describe('wireShadowReceivers', () => {
  let uninstallCanvasMock: () => void;
  beforeAll(() => {
    uninstallCanvasMock = installCanvasMock();
  });
  afterAll(() => uninstallCanvasMock());

  const defaults = {
    cascades: 3,
    shadowMapSize: 512,
    lightDirection: new THREE.Vector3(-1, -1, -1).normalize(),
    lightColor: '#ffeec0' as const,
    lightIntensity: 2.2,
    maxFar: 400,
  };

  it('registers each `receiveShadow` material exactly once', () => {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 500);
    const csm = createCascadedShadows(camera, scene, defaults);

    const matA = new THREE.MeshStandardMaterial();
    const matB = new THREE.MeshStandardMaterial();
    const bank = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), matA);
    bank.receiveShadow = true;
    const water = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), matB);
    water.receiveShadow = true;
    scene.add(bank, water);

    const seen = new Map();
    expect(wireShadowReceivers(csm, scene, seen)).toBe(2);
    // Second walk — no new materials, so nothing is re-registered.
    expect(wireShadowReceivers(csm, scene, seen)).toBe(0);

    csm.remove();
    csm.dispose();
  });

  it('skips meshes that don\'t receive shadows', () => {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 500);
    const csm = createCascadedShadows(camera, scene, defaults);

    const caster = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshStandardMaterial(),
    );
    caster.castShadow = true;
    caster.receiveShadow = false;
    scene.add(caster);

    const seen = new Map();
    expect(wireShadowReceivers(csm, scene, seen)).toBe(0);

    csm.remove();
    csm.dispose();
  });

  it('preserves `this` on the chained callback — endurance regression', () => {
    // drei's `MeshReflectorMaterial.onBeforeCompile` reads `this._hasBlur`
    // from the material. A plain `fn(shader, renderer)` call drops `this`,
    // so the chain has to use `.call(this, …)`. #495 Phase 2 endurance CI
    // caught this: shipping-scene-contrast threw on the water material's
    // reflector.
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 500);
    const csm = createCascadedShadows(camera, scene, defaults);

    const material = new THREE.MeshStandardMaterial() as THREE.MeshStandardMaterial & {
      _probe: boolean;
    };
    material._probe = true;
    let probedThis: unknown = undefined;
    material.onBeforeCompile = function (this: unknown) {
      probedThis = (this as { _probe?: boolean })?._probe;
    };
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
    mesh.receiveShadow = true;
    scene.add(mesh);

    const seen = new Map();
    wireShadowReceivers(csm, scene, seen);

    const shader = {
      vertexShader: '',
      fragmentShader: '#include <lights_fragment_begin>',
      uniforms: {} as Record<string, unknown>,
      defines: {} as Record<string, unknown>,
    };
    material.onBeforeCompile?.call(
      material,
      shader as unknown as THREE.WebGLProgramParametersWithUniforms,
      {} as THREE.WebGLRenderer,
    );
    expect(probedThis).toBe(true);

    csm.remove();
    csm.dispose();
  });

  it('preserves the material\'s existing onBeforeCompile — both callbacks run', () => {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 500);
    const csm = createCascadedShadows(camera, scene, defaults);

    const material = new THREE.MeshStandardMaterial();
    const originalCalls: string[] = [];
    material.onBeforeCompile = () => {
      originalCalls.push('original');
    };
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
    mesh.receiveShadow = true;
    scene.add(mesh);

    const seen = new Map();
    wireShadowReceivers(csm, scene, seen);

    // Simulate three invoking the chained onBeforeCompile at compile time.
    // CSM replaces the `<lights_fragment_begin>` chunk, so seed it.
    const shader = {
      vertexShader: '',
      fragmentShader: '#include <lights_fragment_begin>',
      uniforms: {} as Record<string, unknown>,
      defines: {} as Record<string, unknown>,
    };
    material.onBeforeCompile?.(
      shader as unknown as THREE.WebGLProgramParametersWithUniforms,
      {} as THREE.WebGLRenderer,
    );

    expect(originalCalls).toEqual(['original']);
    // CSM injects its uniforms through onBeforeCompile.
    expect(shader.uniforms).toHaveProperty('CSM_cascades');
    expect(shader.uniforms).toHaveProperty('cameraNear');
    expect(shader.uniforms).toHaveProperty('shadowFar');

    csm.remove();
    csm.dispose();
  });

  it('sets USE_CSM on each registered material\'s defines', () => {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 500);
    const csm = createCascadedShadows(camera, scene, { ...defaults, cascades: 2 });

    const material = new THREE.MeshStandardMaterial();
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
    mesh.receiveShadow = true;
    scene.add(mesh);

    const seen = new Map();
    wireShadowReceivers(csm, scene, seen);

    const defines = (material as unknown as { defines?: Record<string, unknown> }).defines;
    expect(defines?.USE_CSM).toBe(1);
    expect(defines?.CSM_CASCADES).toBe(2);

    csm.remove();
    csm.dispose();
  });

  it('unwires every material back to its original onBeforeCompile and defines', () => {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 500);
    const csm = createCascadedShadows(camera, scene, defaults);

    const material = new THREE.MeshStandardMaterial();
    const originalCalls: string[] = [];
    const originalCb: THREE.Material['onBeforeCompile'] = () => {
      originalCalls.push('after');
    };
    material.onBeforeCompile = originalCb;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
    mesh.receiveShadow = true;
    scene.add(mesh);

    const seen = new Map();
    wireShadowReceivers(csm, scene, seen);
    const defines = () =>
      (material as unknown as { defines?: Record<string, unknown> }).defines;
    expect(defines()?.USE_CSM).toBe(1);

    unwireShadowReceivers(seen);
    expect(material.onBeforeCompile).toBe(originalCb);
    expect(defines()?.USE_CSM).toBeUndefined();
    expect(seen.size).toBe(0);

    csm.remove();
    csm.dispose();
  });

  it('handles meshes with an array of materials', () => {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 500);
    const csm = createCascadedShadows(camera, scene, defaults);

    const matA = new THREE.MeshStandardMaterial();
    const matB = new THREE.MeshStandardMaterial();
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), [matA, matB]);
    mesh.receiveShadow = true;
    scene.add(mesh);

    const seen = new Map();
    expect(wireShadowReceivers(csm, scene, seen)).toBe(2);
    const defines = (m: THREE.Material) =>
      (m as unknown as { defines?: Record<string, unknown> }).defines;
    expect(defines(matA)?.USE_CSM).toBe(1);
    expect(defines(matB)?.USE_CSM).toBe(1);

    csm.remove();
    csm.dispose();
  });
});
