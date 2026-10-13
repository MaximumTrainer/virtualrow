import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  applyAppearance,
  TOP_PALETTE,
  SHORTS_PALETTE,
  SHOES_PALETTE,
  HAIR_PALETTE,
  resolveAppearanceColors,
  type AppearanceColors,
} from '../components/rower3d/rowerAppearance';

/**
 * Build a mock scull whose rower meshes share the SUIT material across the
 * torso and the thighs — matches the authored `scull-male.glb` where top and
 * shorts both point at material 8. The pass has to clone to colour them
 * independently.
 */
const buildMockScull = () => {
  const root = new THREE.Group();
  const suit = new THREE.MeshStandardMaterial({ color: 0x1e3a5f });
  const foot = new THREE.MeshStandardMaterial({ color: 0x2a2a28 });
  const hair = new THREE.MeshStandardMaterial({ color: 0x2a2320 });

  const addMesh = (name: string, material: THREE.MeshStandardMaterial) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), material);
    mesh.name = name;
    root.add(mesh);
    return mesh;
  };

  const meshes = {
    torsoSpine: addMesh('Torso_Spine_part', suit),
    torsoShoulders: addMesh('Torso_Shoulders_part', suit),
    leftThigh: addMesh('LeftThigh_part', suit),
    rightThigh: addMesh('RightThigh_part', suit),
    leftFoot: addMesh('LeftFoot_part', foot),
    rightFoot: addMesh('RightFoot_part', foot),
    hair: addMesh('Hair_part', hair),
    // untouched by the pass:
    head: addMesh('Head_part', new THREE.MeshStandardMaterial({ color: 0xc9a184 })),
  };
  return { root, meshes, originals: { suit, foot, hair } };
};

const RED: AppearanceColors = {
  top: '#C8102E',
  shorts: '#1E6B3C',
  shoes: '#F2F2F0',
  hair: '#D7B378',
  hairstyle: 'short',
  hat: 'none',
  hatColor: '#1A1A1A',
};

describe('applyAppearance', () => {
  it('colours each slot without crosstalk between top and shorts', () => {
    const { root, meshes } = buildMockScull();
    applyAppearance(root, RED);

    expect((meshes.torsoSpine.material as THREE.MeshStandardMaterial).color.getHexString()).toBe(
      'c8102e',
    );
    expect(
      (meshes.torsoShoulders.material as THREE.MeshStandardMaterial).color.getHexString(),
    ).toBe('c8102e');
    expect((meshes.leftThigh.material as THREE.MeshStandardMaterial).color.getHexString()).toBe(
      '1e6b3c',
    );
    expect((meshes.rightThigh.material as THREE.MeshStandardMaterial).color.getHexString()).toBe(
      '1e6b3c',
    );
    expect((meshes.leftFoot.material as THREE.MeshStandardMaterial).color.getHexString()).toBe(
      'f2f2f0',
    );
    expect((meshes.hair.material as THREE.MeshStandardMaterial).color.getHexString()).toBe('d7b378');
  });

  it('leaves unmatched meshes untouched', () => {
    const { root, meshes } = buildMockScull();
    applyAppearance(root, RED);
    expect((meshes.head.material as THREE.MeshStandardMaterial).color.getHexString()).toBe(
      'c9a184',
    );
  });

  it('does not share one material across top and shorts (clones per slot)', () => {
    const { root, meshes, originals } = buildMockScull();
    applyAppearance(root, RED);
    expect(meshes.torsoSpine.material).not.toBe(originals.suit);
    expect(meshes.leftThigh.material).not.toBe(originals.suit);
    expect(meshes.torsoSpine.material).not.toBe(meshes.leftThigh.material);
    // and the original is not mutated
    expect(originals.suit.color.getHexString()).toBe('1e3a5f');
  });

  it('is idempotent on a second call with the same appearance', () => {
    const { root, meshes } = buildMockScull();
    applyAppearance(root, RED);
    const topClone = meshes.torsoSpine.material;
    const shortsClone = meshes.leftThigh.material;

    const setSpy = vi.spyOn(
      (topClone as THREE.MeshStandardMaterial).color,
      'set',
    );
    applyAppearance(root, RED);
    expect(setSpy).not.toHaveBeenCalled();
    expect(meshes.torsoSpine.material).toBe(topClone);
    expect(meshes.leftThigh.material).toBe(shortsClone);
    setSpy.mockRestore();
  });

  it('recolours the same clones when appearance changes', () => {
    const { root, meshes } = buildMockScull();
    applyAppearance(root, RED);
    const topClone = meshes.torsoSpine.material;
    applyAppearance(root, { ...RED, top: '#F2C53C' });
    // same material instance, new colour
    expect(meshes.torsoSpine.material).toBe(topClone);
    expect((meshes.torsoSpine.material as THREE.MeshStandardMaterial).color.getHexString()).toBe(
      'f2c53c',
    );
  });
});

describe('resolveAppearanceColors', () => {
  it('maps slot ids to hex values', () => {
    expect(
      resolveAppearanceColors({
        top: 'red',
        shorts: 'navy',
        shoes: 'silver',
        hair: 'blond',
        hairstyle: 'long',
        hat: 'cap',
        hatColor: 'red',
      }),
    ).toEqual({
      top: '#C8102E',
      shorts: '#1E3A5F',
      shoes: '#C8CCD0',
      hair: '#D7B378',
      hairstyle: 'long',
      hat: 'cap',
      hatColor: '#C8102E',
    });
  });

  it('falls back to the palette default for an unknown id', () => {
    expect(
      resolveAppearanceColors({
        top: 'nope',
        shorts: 'nope',
        shoes: 'nope',
        hair: 'nope',
        hairstyle: 'short',
        hat: 'none',
        hatColor: 'nope',
      }),
    ).toEqual({
      top: TOP_PALETTE[0].hex,
      shorts: SHORTS_PALETTE[0].hex,
      shoes: SHOES_PALETTE[0].hex,
      hair: HAIR_PALETTE[0].hex,
      hairstyle: 'short',
      hat: 'none',
      hatColor: '#1A1A1A',
    });
  });

  it('resolves match-top to the current top colour', () => {
    expect(
      resolveAppearanceColors({
        top: 'yellow',
        shorts: 'navy',
        shoes: 'black',
        hair: 'black',
        hairstyle: 'short',
        hat: 'cap',
        hatColor: 'match-top',
      }).hatColor,
    ).toBe('#F2C53C');
  });
});

// vitest's `vi` is imported lazily here so the spy closures work in jsdom.
import { vi } from 'vitest';

/**
 * Build a mock scull with the Phase 2 node layout: four Hair_<style> groups
 * each carrying a `_part` mesh, plus a `Hat` parent with three Hat_<style>
 * children. Matches what `scripts/build_crew.py` emits after Phase 2.
 */
const buildPhase2MockScull = () => {
  const root = new THREE.Group();
  const hairMat = new THREE.MeshStandardMaterial({ color: 0x2a2320 });
  const hatMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a });

  const addGroup = (name: string, parent: THREE.Object3D): THREE.Group => {
    const g = new THREE.Group();
    g.name = name;
    parent.add(g);
    return g;
  };
  const addMesh = (name: string, material: THREE.MeshStandardMaterial, parent: THREE.Object3D) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), material);
    mesh.name = name;
    parent.add(mesh);
    return mesh;
  };

  const hairstyles = addGroup('Hairstyles', root);
  const hair = {
    short: addGroup('Hair_Short', hairstyles),
    long: addGroup('Hair_Long', hairstyles),
    buzz: addGroup('Hair_Buzz', hairstyles),
    bun: addGroup('Hair_Bun', hairstyles),
  };
  const hairMeshes = {
    short: addMesh('Hair_Short_Cap_part', hairMat, hair.short),
    long: addMesh('Hair_Long_Cap_part', hairMat, hair.long),
    buzz: addMesh('Hair_Buzz_Cap_part', hairMat, hair.buzz),
    bun: addMesh('Hair_Bun_Cap_part', hairMat, hair.bun),
  };

  const hatParent = addGroup('Hat', root);
  const hat = {
    cap: addGroup('Hat_Cap', hatParent),
    visor: addGroup('Hat_Visor', hatParent),
    beanie: addGroup('Hat_Beanie', hatParent),
  };
  const hatMeshes = {
    cap: addMesh('Hat_Cap_Crown_part', hatMat, hat.cap),
    visor: addMesh('Hat_Visor_Band_part', hatMat, hat.visor),
    beanie: addMesh('Hat_Beanie_Dome_part', hatMat, hat.beanie),
  };

  return { root, hair, hairMeshes, hatParent, hat, hatMeshes };
};

describe('applyAppearance — hair & hat geometry visibility (#474 Phase 2)', () => {
  it('shows the selected hairstyle and hides the others', () => {
    const { root, hair } = buildPhase2MockScull();
    applyAppearance(root, { ...RED, hairstyle: 'long' });
    expect(hair.short.visible).toBe(false);
    expect(hair.long.visible).toBe(true);
    expect(hair.buzz.visible).toBe(false);
    expect(hair.bun.visible).toBe(false);
  });

  it('hides the whole hat subtree when hat is none', () => {
    const { root, hatParent, hat } = buildPhase2MockScull();
    applyAppearance(root, { ...RED, hat: 'none' });
    expect(hatParent.visible).toBe(false);
    // children stay toggled too, so a later show-the-parent does not reveal every variant
    expect(hat.cap.visible).toBe(false);
    expect(hat.visor.visible).toBe(false);
    expect(hat.beanie.visible).toBe(false);
  });

  it('shows the selected hat and hides the other hat variants', () => {
    const { root, hatParent, hat } = buildPhase2MockScull();
    applyAppearance(root, { ...RED, hat: 'visor' });
    expect(hatParent.visible).toBe(true);
    expect(hat.cap.visible).toBe(false);
    expect(hat.visor.visible).toBe(true);
    expect(hat.beanie.visible).toBe(false);
  });

  it('colours every hair mesh under every hairstyle to the same hair hex', () => {
    const { root, hairMeshes } = buildPhase2MockScull();
    applyAppearance(root, { ...RED, hair: '#D7B378' });
    for (const mesh of Object.values(hairMeshes)) {
      expect((mesh.material as THREE.MeshStandardMaterial).color.getHexString()).toBe('d7b378');
    }
  });

  it('colours the hat meshes with hatColor', () => {
    const { root, hatMeshes } = buildPhase2MockScull();
    applyAppearance(root, { ...RED, hat: 'cap', hatColor: '#C8102E' });
    expect((hatMeshes.cap.material as THREE.MeshStandardMaterial).color.getHexString()).toBe('c8102e');
    // visor/beanie are hidden, but their colour pass still fires — it won't be visible
    expect((hatMeshes.visor.material as THREE.MeshStandardMaterial).color.getHexString()).toBe('c8102e');
  });

  it('tolerates the Phase 1 GLB layout (single Hair_part, no Hat subtree)', () => {
    // The scule the user has in cache before the Phase 2 regen only has the
    // single Hair_part mesh. The pass must not throw and must still colour
    // the hair.
    const root = new THREE.Group();
    const hairMat = new THREE.MeshStandardMaterial({ color: 0x2a2320 });
    const legacyHair = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), hairMat);
    legacyHair.name = 'Hair_part';
    root.add(legacyHair);

    expect(() =>
      applyAppearance(root, { ...RED, hair: '#D7B378', hairstyle: 'bun', hat: 'cap' }),
    ).not.toThrow();
    expect((legacyHair.material as THREE.MeshStandardMaterial).color.getHexString()).toBe('d7b378');
  });
});
