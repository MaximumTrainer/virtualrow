import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createLocalStorageRowerAppearanceService,
  DEFAULT_ROWER_APPEARANCE,
  ROWER_APPEARANCE_STORAGE_KEY,
  sanitizeAppearance,
} from '../services/rowerAppearanceService';

describe('rowerAppearanceService', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it('reads the default when nothing is stored', () => {
    const service = createLocalStorageRowerAppearanceService();
    expect(service.read()).toEqual(DEFAULT_ROWER_APPEARANCE);
  });

  it('round-trips a written value', () => {
    const service = createLocalStorageRowerAppearanceService();
    const next = { ...DEFAULT_ROWER_APPEARANCE, top: 'red', shorts: 'forest', hair: 'blond' };
    service.write(next);
    expect(service.read()).toEqual(next);
  });

  it('rejects an unknown slot value and falls back to the default', () => {
    localStorage.setItem(
      ROWER_APPEARANCE_STORAGE_KEY,
      JSON.stringify({ ...DEFAULT_ROWER_APPEARANCE, top: 'puce' }),
    );
    const service = createLocalStorageRowerAppearanceService();
    expect(service.read().top).toBe(DEFAULT_ROWER_APPEARANCE.top);
  });

  it('returns the default when storage holds garbage JSON', () => {
    localStorage.setItem(ROWER_APPEARANCE_STORAGE_KEY, 'not json');
    expect(createLocalStorageRowerAppearanceService().read()).toEqual(DEFAULT_ROWER_APPEARANCE);
  });

  it('sanitizeAppearance keeps the valid fields and defaults the rest', () => {
    const result = sanitizeAppearance({
      top: 'red',
      shorts: 'nope',
      hat: 'cap',
      hairstyle: 'bogus',
      hatColor: 'match-top',
    });
    expect(result.top).toBe('red');
    expect(result.shorts).toBe(DEFAULT_ROWER_APPEARANCE.shorts);
    expect(result.hat).toBe('cap');
    expect(result.hairstyle).toBe(DEFAULT_ROWER_APPEARANCE.hairstyle);
    // 'match-top' is a legitimate hat-colour id (D4), unlike top/shorts/hair.
    expect(result.hatColor).toBe('match-top');
  });

  it('sanitizeAppearance rejects an unknown hatColor id', () => {
    const result = sanitizeAppearance({ ...DEFAULT_ROWER_APPEARANCE, hatColor: 'puce' });
    expect(result.hatColor).toBe(DEFAULT_ROWER_APPEARANCE.hatColor);
  });
});
