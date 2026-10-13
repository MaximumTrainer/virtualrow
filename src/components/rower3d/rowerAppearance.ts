import * as THREE from 'three';

// ============================================================================
// ROWER APPEARANCE — the per-athlete clothing / hair / hat picker (#474).
//
// The crew GLBs (`scripts/build_crew.py`) ship with a baked palette: navy
// unisuit, white stripe, dark hair, black shoes. This module overrides the
// `MeshStandardMaterial.color` on named rower nodes at runtime so an athlete
// can pick their own top / shorts / shoes / hair / hat colour without
// regenerating the GLB. Phase 2 (#474) adds four hairstyle siblings and three
// hat siblings; the pass shows the selected one and hides the others.
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
//
// Why the pass tolerates the Phase 1 GLB layout: the Phase 2 generator renames
// the single `Hair` node to `Hair_Short` and adds three sibling hairstyles.
// Until a reader's cached GLBs are regenerated with the Phase 2 generator the
// scene still carries the Phase 1 `Hair_part` mesh, so the colour match keeps
// recognising it; the visibility toggle is a no-op in that case.
// ============================================================================

/** Where in the loaded GLB each colourable slot lives. */
const SLOT_NODE_PATTERNS = {
  top: /^(Torso_Spine|Torso_Shoulders)_part$/,
  shorts: /^(Left|Right)Thigh_part$/,
  shoes: /^(Left|Right)Foot_part$/,
  /** Match both Phase 1's single Hair_part and Phase 2's Hair_<Style>_<Part>_part. */
  hair: /^Hair(_(Short|Long|Buzz|Bun))?(_[A-Za-z]+)?_part$/,
  /** Phase 2 only — Hat_<Style>_<Part>_part. */
  hat: /^Hat_(Cap|Visor|Beanie)(_[A-Za-z]+)?_part$/,
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

export type HairstyleId = 'short' | 'long' | 'buzz' | 'bun';
export type HatId = 'none' | 'cap' | 'visor' | 'beanie';

export interface AppearanceColors {
  /** Hex colour for the torso (unisuit top). */
  top: string;
  /** Hex colour for the thighs (unisuit shorts). */
  shorts: string;
  /** Hex colour for the shoes. */
  shoes: string;
  /** Hex colour for the hair. */
  hair: string;
  /** Which hairstyle sibling to show; others are hidden. */
  hairstyle: HairstyleId;
  /** Which hat sibling to show; 'none' hides the whole hat subtree. */
  hat: HatId;
  /** Hex colour for the active hat (ignored when hat === 'none'). */
  hatColor: string;
}

const HAIRSTYLE_NODE: Record<HairstyleId, string> = {
  short: 'Hair_Short',
  long: 'Hair_Long',
  buzz: 'Hair_Buzz',
  bun: 'Hair_Bun',
};

const HAT_NODE: Record<Exclude<HatId, 'none'>, string> = {
  cap: 'Hat_Cap',
  visor: 'Hat_Visor',
  beanie: 'Hat_Beanie',
};

/**
 * Show/hide the hairstyle and hat subtrees to match `appearance`.
 *
 * No-op on a GLB that does not carry the sibling nodes yet (the Phase 1
 * cached asset), so the renderer stays safe while the GLB migration lands.
 */
const applyGeometryVisibility = (root: THREE.Object3D, appearance: AppearanceColors): void => {
  // Hairstyle siblings. The Phase 2 GLB nests them under a `Hairstyles` group;
  // we match by name on the root so the pass works whether the group exists
  // or not.
  (Object.entries(HAIRSTYLE_NODE) as [HairstyleId, string][]).forEach(([id, nodeName]) => {
    const node = root.getObjectByName(nodeName);
    if (node) node.visible = id === appearance.hairstyle;
  });

  // Hat parent + variants. 'none' hides the whole subtree; otherwise show
  // the parent and the matching child only.
  const hatParent = root.getObjectByName('Hat');
  if (hatParent) hatParent.visible = appearance.hat !== 'none';
  (Object.entries(HAT_NODE) as [Exclude<HatId, 'none'>, string][]).forEach(([id, nodeName]) => {
    const node = root.getObjectByName(nodeName);
    if (node) node.visible = appearance.hat === id;
  });
};

const colorForSlot = (
  slot: AppearanceSlot,
  appearance: AppearanceColors,
): string => {
  switch (slot) {
    case 'top':
      return appearance.top;
    case 'shorts':
      return appearance.shorts;
    case 'shoes':
      return appearance.shoes;
    case 'hair':
      return appearance.hair;
    case 'hat':
      return appearance.hatColor;
  }
};

/**
 * Override the colour slots on the rower meshes and set hairstyle/hat
 * visibility.
 *
 * Idempotent: a second call with the same `appearance` is a no-op for colour
 * (the `APPLIED_VERSION` marker on each cloned material gates the writes).
 * Visibility is re-asserted each call — it is cheap and keeps a stray
 * `.visible = false` elsewhere from drifting the state.
 */
export const applyAppearance = (root: THREE.Object3D, appearance: AppearanceColors): void => {
  const version = `${appearance.top}|${appearance.shorts}|${appearance.shoes}|${appearance.hair}|${appearance.hatColor}`;
  applyGeometryVisibility(root, appearance);
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

    target.color.set(colorForSlot(slot, appearance));
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

/** Hat palette — the standard 4 colours plus the 'match top' alias (D4). */
export const HAT_PALETTE: readonly PaletteOption[] = [
  { id: 'black', label: 'Black', hex: '#1A1A1A' },
  { id: 'white', label: 'White', hex: '#F2F2F0' },
  { id: 'navy', label: 'Navy', hex: '#1E3A5F' },
  { id: 'red', label: 'Red', hex: '#C8102E' },
  { id: 'match-top', label: 'Match top', hex: '#1E3A5F' },
];

export interface HairstyleOption {
  readonly id: HairstyleId;
  readonly label: string;
}

export const HAIRSTYLE_OPTIONS: readonly HairstyleOption[] = [
  { id: 'short', label: 'Short' },
  { id: 'long', label: 'Long' },
  { id: 'buzz', label: 'Buzz' },
  { id: 'bun', label: 'Bun' },
];

export interface HatOption {
  readonly id: HatId;
  readonly label: string;
}

export const HAT_OPTIONS: readonly HatOption[] = [
  { id: 'none', label: 'None' },
  { id: 'cap', label: 'Cap' },
  { id: 'visor', label: 'Visor' },
  { id: 'beanie', label: 'Beanie' },
];

export const SLOT_PALETTE: Record<Exclude<AppearanceSlot, 'hat'>, readonly PaletteOption[]> = {
  top: TOP_PALETTE,
  shorts: SHORTS_PALETTE,
  shoes: SHOES_PALETTE,
  hair: HAIR_PALETTE,
};

const hexById = (palette: readonly PaletteOption[], id: string): string => {
  const entry = palette.find((option) => option.id === id);
  return entry ? entry.hex : palette[0].hex;
};

/** Resolve the hat colour; 'match-top' follows the current top slot. */
const resolveHatHex = (hatColor: string, topHex: string): string => {
  if (hatColor === 'match-top') return topHex;
  const entry = HAT_PALETTE.find((option) => option.id === hatColor);
  return entry ? entry.hex : HAT_PALETTE[0].hex;
};

export const resolveAppearanceColors = (preference: {
  top: string;
  shorts: string;
  shoes: string;
  hair: string;
  hairstyle: HairstyleId;
  hat: HatId;
  hatColor: string;
}): AppearanceColors => {
  const topHex = hexById(TOP_PALETTE, preference.top);
  return {
    top: topHex,
    shorts: hexById(SHORTS_PALETTE, preference.shorts),
    shoes: hexById(SHOES_PALETTE, preference.shoes),
    hair: hexById(HAIR_PALETTE, preference.hair),
    hairstyle: preference.hairstyle,
    hat: preference.hat,
    hatColor: resolveHatHex(preference.hatColor, topHex),
  };
};
