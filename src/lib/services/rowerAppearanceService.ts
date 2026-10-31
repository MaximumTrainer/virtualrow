// ============================================================================
// Rower appearance preference, persisted to `virtualrow:appearance:v1` (#474).
//
// Backed by `localStorage` today so a guest's choice survives a reload, same
// pattern as `useCrewPreference`. The versioned key leaves a seam for #37 /
// Postgres: when a signed-in athlete's preferences move server-side, swap the
// adapter and callers that depend on the port stay unchanged.
// ============================================================================

import type { AppearanceSlot, HairstyleId, HatId } from '../../components/rower3d/rowerAppearance';
import {
  TOP_PALETTE,
  SHORTS_PALETTE,
  SHOES_PALETTE,
  HAIR_PALETTE,
  HAT_PALETTE,
} from '../../components/rower3d/rowerAppearance';

export const ROWER_APPEARANCE_STORAGE_KEY = 'virtualrow:appearance:v1';

export interface RowerAppearancePreference {
  top: string;
  shorts: string;
  shoes: string;
  hair: string;
  /** Hairstyle variant (#474 Phase 2). */
  hairstyle: HairstyleId;
  /** Hat geometry (#474 Phase 2). 'none' hides the hat subtree. */
  hat: HatId;
  /** Hat colour (#474 Phase 2). 'match-top' tracks the top slot. */
  hatColor: string;
}

/** The baked-in look (`scripts/build_crew.py:54`) — unchanged on a cold load (D7). */
export const DEFAULT_ROWER_APPEARANCE: RowerAppearancePreference = {
  top: 'navy',
  shorts: 'navy',
  shoes: 'black',
  hair: 'black',
  hairstyle: 'short',
  hat: 'none',
  hatColor: 'black',
};

const idSet = (palette: readonly { id: string }[]): Set<string> =>
  new Set(palette.map((option) => option.id));

const TOP_IDS = idSet(TOP_PALETTE);
const SHORTS_IDS = idSet(SHORTS_PALETTE);
const SHOES_IDS = idSet(SHOES_PALETTE);
const HAIR_IDS = idSet(HAIR_PALETTE);
const HAT_COLOR_IDS = idSet(HAT_PALETTE);
const HAIRSTYLES = new Set<HairstyleId>(['short', 'long', 'buzz', 'bun']);
const HATS = new Set<HatId>(['none', 'cap', 'visor', 'beanie']);

const isHairstyle = (value: unknown): value is HairstyleId =>
  typeof value === 'string' && HAIRSTYLES.has(value as HairstyleId);
const isHat = (value: unknown): value is HatId =>
  typeof value === 'string' && HATS.has(value as HatId);

/** Fall back to the default for any slot a stored value no longer matches. */
export const sanitizeAppearance = (value: unknown): RowerAppearancePreference => {
  const raw = (value ?? {}) as Partial<RowerAppearancePreference>;
  return {
    top: raw.top && TOP_IDS.has(raw.top) ? raw.top : DEFAULT_ROWER_APPEARANCE.top,
    shorts: raw.shorts && SHORTS_IDS.has(raw.shorts) ? raw.shorts : DEFAULT_ROWER_APPEARANCE.shorts,
    shoes: raw.shoes && SHOES_IDS.has(raw.shoes) ? raw.shoes : DEFAULT_ROWER_APPEARANCE.shoes,
    hair: raw.hair && HAIR_IDS.has(raw.hair) ? raw.hair : DEFAULT_ROWER_APPEARANCE.hair,
    hairstyle: isHairstyle(raw.hairstyle) ? raw.hairstyle : DEFAULT_ROWER_APPEARANCE.hairstyle,
    hat: isHat(raw.hat) ? raw.hat : DEFAULT_ROWER_APPEARANCE.hat,
    hatColor:
      raw.hatColor && HAT_COLOR_IDS.has(raw.hatColor)
        ? raw.hatColor
        : DEFAULT_ROWER_APPEARANCE.hatColor,
  };
};

export interface RowerAppearanceService {
  read(): RowerAppearancePreference;
  write(appearance: RowerAppearancePreference): void;
}

/**
 * localStorage-backed adapter. A read that throws (private browsing, storage
 * disabled) returns the default; a write that throws is swallowed so the
 * choice at least applies to the current session.
 */
export const createLocalStorageRowerAppearanceService = (): RowerAppearanceService => ({
  read: () => {
    try {
      const raw = localStorage.getItem(ROWER_APPEARANCE_STORAGE_KEY);
      if (!raw) return { ...DEFAULT_ROWER_APPEARANCE };
      return sanitizeAppearance(JSON.parse(raw));
    } catch {
      return { ...DEFAULT_ROWER_APPEARANCE };
    }
  },
  write: (appearance) => {
    try {
      localStorage.setItem(ROWER_APPEARANCE_STORAGE_KEY, JSON.stringify(appearance));
    } catch {
      // The choice still applies to this session.
    }
  },
});

export type AppearanceColorSlot = Extract<AppearanceSlot, 'top' | 'shorts' | 'shoes' | 'hair'>;
