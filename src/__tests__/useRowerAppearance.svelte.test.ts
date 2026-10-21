import { describe, it, expect, vi } from 'vitest';

import { RowerAppearanceStore } from '../lib/ui/useRowerAppearance.svelte';
import {
  DEFAULT_ROWER_APPEARANCE,
  type RowerAppearancePreference,
  type RowerAppearanceService,
} from '../lib/services/rowerAppearanceService';

function stubService(initial: RowerAppearancePreference = DEFAULT_ROWER_APPEARANCE) {
  let stored: RowerAppearancePreference = { ...initial };
  return {
    read: vi.fn(() => ({ ...stored })),
    write: vi.fn((next: RowerAppearancePreference) => {
      stored = { ...next };
    }),
    get stored() {
      return stored;
    },
  } as unknown as RowerAppearanceService & { stored: RowerAppearancePreference };
}

// #542 P1 Row screen: the appearance store ported from useRowerAppearance.
describe('RowerAppearanceStore', () => {
  it('seeds its appearance from the service', () => {
    const service = stubService({ ...DEFAULT_ROWER_APPEARANCE, top: 'crimson' });
    const store = new RowerAppearanceStore(service);
    expect(store.appearance.top).toBe('crimson');
    expect(service.read).toHaveBeenCalled();
  });

  it('setSlot updates one slot and writes the whole preference', () => {
    const service = stubService();
    const store = new RowerAppearanceStore(service);
    store.setSlot('hat', 'cap');
    expect(store.appearance.hat).toBe('cap');
    // The other slots are untouched.
    expect(store.appearance.top).toBe(DEFAULT_ROWER_APPEARANCE.top);
    expect(service.write).toHaveBeenCalledWith(expect.objectContaining({ hat: 'cap' }));
  });

  it('reset restores the default appearance and persists it', () => {
    const service = stubService();
    const store = new RowerAppearanceStore(service);
    store.setSlot('top', 'crimson');
    store.reset();
    expect(store.appearance).toEqual(DEFAULT_ROWER_APPEARANCE);
    expect(service.write).toHaveBeenLastCalledWith(DEFAULT_ROWER_APPEARANCE);
  });
});
