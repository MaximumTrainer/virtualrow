import { describe, it, expect, beforeEach } from 'vitest';

import {
  CrewPreferenceStore,
  CREW_PREFERENCE_STORAGE_KEY,
  CREW_PREFERENCE_OPTIONS,
} from '../lib/ui/useCrewPreference.svelte';

// #542 P1 Row screen: the crew-preference store ported from useCrewPreference.
describe('CrewPreferenceStore', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('offers auto / female / male options with hints', () => {
    expect(CREW_PREFERENCE_OPTIONS.map((o) => o.value)).toEqual(['auto', 'female', 'male']);
    expect(CREW_PREFERENCE_OPTIONS.every((o) => o.label && o.hint)).toBe(true);
  });

  it('defaults to auto', () => {
    expect(new CrewPreferenceStore().preference).toBe('auto');
  });

  it('sets, persists and reads back a preference', () => {
    const store = new CrewPreferenceStore();
    store.setPreference('female');
    expect(store.preference).toBe('female');
    expect(localStorage.getItem(CREW_PREFERENCE_STORAGE_KEY)).toBe('female');
    expect(new CrewPreferenceStore().preference).toBe('female');
  });

  it('falls back to auto for an unknown stored value', () => {
    localStorage.setItem(CREW_PREFERENCE_STORAGE_KEY, 'robot');
    expect(new CrewPreferenceStore().preference).toBe('auto');
  });
});
