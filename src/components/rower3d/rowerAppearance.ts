import * as THREE from 'three';

// ============================================================================
// ROWER APPEARANCE — the per-athlete clothing / hair palette (#474).
//
// The crew GLBs (`scripts/build_crew.py`) ship with a baked palette: navy
// unisuit, white stripe, dark hair, black shoes. This module overrides the
// `MeshStandardMaterial.color` on named rower nodes at runtime so an athlete
// can pick their own top / shorts / shoes / hair colour without regenerating
// the GLB.
//
// Why runtime and not baked: per-athlete GLBs would multiply the asset count
// combinatorially and defeat the drei `useGLTF` cache. Overriding the color on
// an existing `MeshStandardMaterial` leaves `normalMap`/`roughnessMap` intact,
// which is what `dressScull` relies on for the scull hull (#349, #437).
//
// Why the pass clones materials: `Torso_Spine_part`, `Torso_Shoulders_part`,
// `LeftThigh_part` and `RightThigh_part` all share material index 8 in the
// authored GLB (the SUIT colour). Three.js shares the JS `MeshStandardMaterial`
// instance across every mesh pointing at the same material index, so a naive
// `color.set` would paint top AND shorts in one go. The pass clones per slot
// the first time it runs; the clone is marked so subsequent passes recolour
// the same clone instead of growing a chain.
// ============================================================================

/** Where in the loaded GLB each colourable slot lives. */
const SLOT_NODE_PATTERNS = {
  top: /^(Torso_Spine|Torso_Shoulders)_part$/,
  shorts: /^(Left|Right)Thigh_part$/,
  shoes: /^(Left|Right)Foot_part$/,
  hair: /^Hair_part$/,
} as const;

export type AppearanceSlot = keyof typeof SLOT_NODE_PATTERNS;

/** Marks a material cloned by this module so a second pass is a no-op. */
const CLONED_FOR = '__virtualrowAppearanceSlot';
const APPLIED_VERSION = '__virtualrowAppearanceVersion';

const slotOf = (material: THREE.Material): AppearanceSlot | undefined =>
  (material as unknown as Record<string, unknown>)[CLONED_FOR] as AppearanceSlot | undefined;

const markSlot = <T extends THREE.Material>(material: T, slot: AppearanceSlot): T => {
  (material as unknown as Record<string, unknown>)[CLONED_FOR] = slot;
  return material;
};

const classifySlot = (meshName: string): AppearanceSlot | undefined => {
  for (const slot of Object.keys(SLOT_NODE_PATTERNS) as AppearanceSlot[]) {
    if (SLOT_NODE_PATTERNS[slot].test(meshName)) return slot;
  }
  return undefined;
};

export interface AppearanceColors {
  /** Hex colour for the torso (unisuit top). */
  top: string;
  /** Hex colour for the thighs (unisuit shorts). */
  shorts: string;
  /** Hex colour for the shoes. */
  shoes: string;
  /** Hex colour for the hair. */
  hair: string;
}

/**
 * Override the four colour slots on the rower meshes.
 *
 * Idempotent: a second call with the same `appearance` is a no-op (the
 * `APPLIED_VERSION` marker on each cloned material gates the writes). A call
 * with a different `appearance` recolours the existing clones rather than
 * creating new ones, so re-rendering a scene with a changed appearance costs
 * one `color.set` per matching mesh.
 */
export const applyAppearance = (root: THREE.Object3D, appearance: AppearanceColors): void => {
  const version = `${appearance.top}|${appearance.shorts}|${appearance.shoes}|${appearance.hair}`;
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    const slot = classifySlot(mesh.name);
    if (!slot) return;
    const current = mesh.material as THREE.Material | THREE.Material[] | null;
    if (!current || Array.isArray(current)) return;
    const standard = current as THREE.MeshStandardMaterial;
    if (!standard.color) return;

    let target = standard;
    const existingSlot = slotOf(standard);
    if (existingSlot !== slot) {
      // First visit of this slot's mesh (or a mesh accidentally sharing a
      // material with a different slot): clone so the override stays scoped.
      target = standard.clone() as THREE.MeshStandardMaterial;
      markSlot(target, slot);
      mesh.material = target;
    }

    const prevVersion = (target as unknown as Record<string, unknown>)[APPLIED_VERSION];
    if (prevVersion === version) return;

    target.color.set(appearance[slot]);
    (target as unknown as Record<string, unknown>)[APPLIED_VERSION] = version;
  });
};

// ============================================================================
// PALETTE
//
// Fixed per-slot palettes (D4 on #474). Chosen for contrast against the
// shipping-scene water sample used by the #433 / #455 ENVIRONMENT_INTENSITY
// baseline; the guard in `src/__tests__/rowerAppearancePalette.test.ts` runs
// every entry through `chromaticApart` so a future change cannot silently
// introduce a colour that reads as water.
// ============================================================================

export interface PaletteOption {
  readonly id: string;
  readonly label: string;
  readonly hex: string;
}

export const TOP_PALETTE: readonly PaletteOption[] = [
  { id: 'navy', label: 'Navy', hex: '#1E3A5F' },
  { id: 'red', label: 'Red', hex: '#C8102E' },
  { id: 'black', label: 'Black', hex: '#1A1A1A' },
  { id: 'white', label: 'White', hex: '#F2F2F0' },
  { id: 'royal', label: 'Royal', hex: '#1F4FA8' },
  { id: 'forest', label: 'Forest', hex: '#1E6B3C' },
  { id: 'yellow', label: 'Yellow', hex: '#F2C53C' },
  { id: 'magenta', label: 'Magenta', hex: '#C83A74' },
];

export const SHORTS_PALETTE: readonly PaletteOption[] = TOP_PALETTE;

export const SHOES_PALETTE: readonly PaletteOption[] = [
  { id: 'black', label: 'Black', hex: '#2A2A28' },
  { id: 'white', label: 'White', hex: '#F2F2F0' },
  { id: 'red', label: 'Red', hex: '#C8102E' },
  { id: 'silver', label: 'Silver', hex: '#C8CCD0' },
];

export const HAIR_PALETTE: readonly PaletteOption[] = [
  { id: 'black', label: 'Black', hex: '#2A2320' },
  { id: 'dark-brown', label: 'Dark brown', hex: '#4A3626' },
  { id: 'light-brown', label: 'Light brown', hex: '#8A6238' },
  { id: 'blond', label: 'Blond', hex: '#D7B378' },
  { id: 'auburn', label: 'Auburn', hex: '#8E3A1F' },
  { id: 'grey', label: 'Grey', hex: '#B8B8B4' },
];

export const SLOT_PALETTE: Record<AppearanceSlot, readonly PaletteOption[]> = {
  top: TOP_PALETTE,
  shorts: SHORTS_PALETTE,
  shoes: SHOES_PALETTE,
  hair: HAIR_PALETTE,
};

const hexById = (palette: readonly PaletteOption[], id: string): string => {
  const entry = palette.find((option) => option.id === id);
  return entry ? entry.hex : palette[0].hex;
};

export const resolveAppearanceColors = (preference: {
  top: string;
  shorts: string;
  shoes: string;
  hair: string;
}): AppearanceColors => ({
  top: hexById(TOP_PALETTE, preference.top),
  shorts: hexById(SHORTS_PALETTE, preference.shorts),
  shoes: hexById(SHOES_PALETTE, preference.shoes),
  hair: hexById(HAIR_PALETTE, preference.hair),
});
