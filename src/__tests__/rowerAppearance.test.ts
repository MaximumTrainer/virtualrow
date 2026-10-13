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

const RED: AppearanceColors = { top: '#C8102E', shorts: '#1E6B3C', shoes: '#F2F2F0', hair: '#D7B378' };

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
      resolveAppearanceColors({ top: 'red', shorts: 'navy', shoes: 'silver', hair: 'blond' }),
    ).toEqual({ top: '#C8102E', shorts: '#1E3A5F', shoes: '#C8CCD0', hair: '#D7B378' });
  });

  it('falls back to the palette default for an unknown id', () => {
    expect(
      resolveAppearanceColors({
        top: 'nope',
        shorts: 'nope',
        shoes: 'nope',
        hair: 'nope',
      }),
    ).toEqual({
      top: TOP_PALETTE[0].hex,
      shorts: SHORTS_PALETTE[0].hex,
      shoes: SHOES_PALETTE[0].hex,
      hair: HAIR_PALETTE[0].hex,
    });
  });
});

// vitest's `vi` is imported lazily here so the spy closures work in jsdom.
import { vi } from 'vitest';
