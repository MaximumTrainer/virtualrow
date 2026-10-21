import { describe, it, expect, beforeEach } from 'vitest';
import { flushSync } from 'svelte';

import {
  ConditionsStore,
  CONDITIONS_STORAGE_KEY,
  type ConditionsChoice,
} from '../lib/ui/useConditions.svelte';
import { CONDITIONS } from '../components/rower3d/conditions';

// #542 P1 Row screen: the conditions store ported from the React useConditions.
describe('ConditionsStore', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('defaults to auto and resolves to a real preset', () => {
    const store = new ConditionsStore();
    expect(store.choice).toBe('auto');
    const stop = $effect.root(() => {
      flushSync();
      // auto resolves against the clock (or midday under test mode) — either way
      // it is one of the real presets, never 'auto'.
      expect(CONDITIONS).toContain(store.conditions);
    });
    stop();
  });

  it('a chosen preset is in force and the scene config follows it', () => {
    const store = new ConditionsStore();
    const stop = $effect.root(() => {
      store.setChoice('dusk');
      flushSync();
      expect(store.choice).toBe('dusk');
      expect(store.conditions).toBe('dusk');
      // sceneConfig is SCENE_CONFIG with the preset applied — a real object.
      expect(store.sceneConfig).toBeTruthy();
    });
    stop();
  });

  it('persists the choice and reads it back', () => {
    const store = new ConditionsStore();
    store.setChoice('golden');
    expect(localStorage.getItem(CONDITIONS_STORAGE_KEY)).toBe('golden');
    expect(new ConditionsStore().choice).toBe('golden');
  });

  it('ignores a value that is not a valid choice', () => {
    const store = new ConditionsStore();
    store.setChoice('not-a-condition' as ConditionsChoice);
    expect(store.choice).toBe('auto');
    expect(localStorage.getItem(CONDITIONS_STORAGE_KEY)).toBeNull();
  });
});
