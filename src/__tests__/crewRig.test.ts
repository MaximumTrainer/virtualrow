import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  GLB_ROWER_NODES,
  GLB_OAR_NODES,
  dressScull,
  litBySky,
  SCENERY_ENV_MAP_INTENSITY,
} from '../components/rower3d/crewRig';
import * as THREE from 'three';

/**
 * Every node the scene animates has to exist in the shipped model.
 *
 * The rower's arms were never animated at all in the GLB scull, so nothing
 * would have noticed a rename: the failure mode is a rower sitting rigid while
 * the oars sweep, which looks like a styling choice rather than a fault (#273).
 */
/** The crewed models. scull.glb is the boat alone and carries no rower. */
const CREW_MODELS = [
  'public/assets/boat/scull-male.glb',
  'public/assets/boat/scull-female.glb',
];

/** Every boat model, crewed or not, sweeps oars. */
const ALL_BOAT_MODELS = ['public/assets/boat/scull.glb', ...CREW_MODELS];

/** Node names from a GLB's JSON chunk. */
const nodeNames = (file: string): string[] => {
  const data = fs.readFileSync(path.join(process.cwd(), file));
  const jsonLength = data.readUInt32LE(12);
  const json = JSON.parse(data.subarray(20, 20 + jsonLength).toString('utf8'));
  return (json.nodes ?? []).map((n: { name?: string }) => n.name ?? '');
};

describe('the crew rig exposes what the scene animates', () => {
  for (const model of CREW_MODELS) {
    it(`${model.split('/').pop()} carries every rower node the stroke moves`, () => {
      const names = new Set(nodeNames(model));

      const missing = GLB_ROWER_NODES.filter((n) => !names.has(n));

      expect(
        missing,
        `${model} is missing nodes the scene animates — the rower would sit still`,
      ).toEqual([]);
    });
  }

  for (const model of ALL_BOAT_MODELS) {
    it(`${model.split('/').pop()} carries both oars`, () => {
      const names = new Set(nodeNames(model));

      expect(GLB_OAR_NODES.filter((n) => !names.has(n))).toEqual([]);
    });
  }

  it('does not expect a rower in the uncrewed scull', () => {
    // scull.glb is the boat on its own. Asserting rower nodes there would fail
    // for a model that is doing exactly what it should.
    const names = new Set(nodeNames('public/assets/boat/scull.glb'));

    expect([...names].some((n) => n.includes('Rower'))).toBe(false);
  });

  // The slide. The rig has always authored it and nothing ever moved it, so
  // the rower's legs compressed while their seat stayed where it was — they
  // shrank and grew rather than sliding (#330).
  it('names the seat, so the rower can slide', () => {
    expect(GLB_ROWER_NODES).toContain('Seat');
  });

  it('names the arms and the oars, so a stroke can move both', () => {
    expect(GLB_ROWER_NODES).toContain('Rower_LeftArm');
    expect(GLB_ROWER_NODES).toContain('Rower_RightArm');
    expect(GLB_OAR_NODES).toContain('LeftOar');
    expect(GLB_OAR_NODES).toContain('RightOar');
  });
});

/**
 * Issue #349 — the scull reflects the sky.
 *
 * Every GLB in the kit ships a flat `baseColorFactor` and nothing else, and
 * until this issue the scene had no usable environment map to reflect, so the
 * hull read as matte plastic and the metal rigger as dark grey. `dressScull`
 * swaps in materials that answer to an environment: a clearcoat on the hull, a
 * metal on the rigger and the gates.
 *
 * The exporter names a group and hangs the geometry on a `_part` child — the
 * meshes are `Hull_part`, `LeftGate_part`, `LeftOar_Blade_part` — so matching
 * on the group name alone would dress nothing.
 */
describe('dressing the scull', () => {
  const scull = () => {
    const root = new THREE.Group();
    for (const name of [
      'Hull_part',
      'Hull_Underside_part',
      'LeftRigger_part',
      'LeftRig_Stay1_part',
      'LeftGate_part',
      'LeftOar_Blade_part',
      'Seat_Pan_part',
      'Rower_Torso_part',
    ]) {
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshStandardMaterial({ color: '#c43b2f' }),
      );
      mesh.name = name;
      root.add(mesh);
    }
    return root;
  };

  const meshNamed = (root: THREE.Object3D, name: string) =>
    root.getObjectByName(name) as THREE.Mesh;

  it('gives the hull a clearcoat, the way a painted boat has one', () => {
    const root = scull();

    dressScull(root);

    for (const name of ['Hull_part', 'Hull_Underside_part']) {
      const material = meshNamed(root, name).material as THREE.MeshPhysicalMaterial;
      expect(material, name).toBeInstanceOf(THREE.MeshPhysicalMaterial);
      expect(material.clearcoat, name).toBeGreaterThanOrEqual(0.8);
      expect(material.roughness, name).toBeLessThan(0.5);
    }
  });

  it('makes the rigger and the gates read as metal', () => {
    const root = scull();

    dressScull(root);

    for (const name of ['LeftRigger_part', 'LeftRig_Stay1_part', 'LeftGate_part']) {
      const material = meshNamed(root, name).material as THREE.MeshStandardMaterial;
      expect(material.metalness, name).toBeGreaterThanOrEqual(0.8);
      expect(material.roughness, name).toBeLessThanOrEqual(0.3);
    }
  });

  // A blade is painted, not chromed, and it is the part a rower sees most.
  it('leaves the blade matte rather than metal', () => {
    const root = scull();

    dressScull(root);

    const material = meshNamed(root, 'LeftOar_Blade_part').material as THREE.MeshStandardMaterial;
    expect(material.metalness).toBeLessThan(0.5);
    expect(material.roughness).toBeGreaterThan(0.3);
  });

  /**
   * The club's colours survive.
   *
   * The GLB's `baseColorFactor` is the only thing distinguishing one boat from
   * another, and a material pass that dropped it would paint every scull the
   * same. Every dressed mesh keeps the colour it arrived with.
   */
  it('keeps every part’s own colour', () => {
    const root = scull();

    dressScull(root);

    root.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      const material = mesh.material as THREE.MeshStandardMaterial;
      expect(`#${material.color.getHexString()}`, mesh.name).toBe('#c43b2f');
    });
  });

  it('leaves the parts it has no opinion about alone', () => {
    const root = scull();
    const before = meshNamed(root, 'Rower_Torso_part').material;

    dressScull(root);

    expect(meshNamed(root, 'Rower_Torso_part').material).toBe(before);
  });

  // Called once after the GLB loads, and the scene may re-render many times.
  it('can be applied twice without building a third material', () => {
    const root = scull();

    dressScull(root);
    const first = meshNamed(root, 'Hull_part').material;
    dressScull(root);

    expect(meshNamed(root, 'Hull_part').material).toBe(first);
  });
});

/**
 * Issue #349 — the flat-colour kit takes the sky's tint.
 *
 * The scenery GLBs are `baseColorFactor` and nothing else, so without a little
 * of the environment on them a white clubhouse reads as paper against a blue
 * sky. Half strength: the kit should take the sky's colour, not its shine.
 */
describe('lighting the scenery kit by the sky', () => {
  it('turns the environment up on every standard material it finds', () => {
    const root = new THREE.Group();
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ color: '#ffffff' }),
    );
    root.add(mesh);

    litBySky(root);

    expect((mesh.material as THREE.MeshStandardMaterial).envMapIntensity).toBe(
      SCENERY_ENV_MAP_INTENSITY,
    );
  });

  // Half, not full: a boathouse is painted timber, not a mirror.
  it('does not make the kit shiny', () => {
    expect(SCENERY_ENV_MAP_INTENSITY).toBeGreaterThan(0);
    expect(SCENERY_ENV_MAP_INTENSITY).toBeLessThan(1);
  });

  // A basic material has no environment to take, and assigning one would put a
  // property on it that three never reads.
  it('leaves a material with no environment alone', () => {
    const root = new THREE.Group();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
    root.add(mesh);

    expect(() => litBySky(root)).not.toThrow();
    expect('envMapIntensity' in mesh.material).toBe(false);
  });
});
