import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useRowerAppearance } from '../hooks/useRowerAppearance';
import {
  DEFAULT_ROWER_APPEARANCE,
  type RowerAppearancePreference,
  type RowerAppearanceService,
} from '../lib/services/rowerAppearanceService';

const stubService = (
  initial: RowerAppearancePreference = { ...DEFAULT_ROWER_APPEARANCE },
): RowerAppearanceService & { writes: RowerAppearancePreference[] } => {
  const writes: RowerAppearancePreference[] = [];
  let current = { ...initial };
  return {
    read: () => ({ ...current }),
    write: (next) => {
      current = { ...next };
      writes.push({ ...next });
    },
    writes,
  };
};

describe('useRowerAppearance', () => {
  it('exposes the service default on first render', () => {
    const service = stubService();
    const { result } = renderHook(() => useRowerAppearance(service));
    expect(result.current.appearance).toEqual(DEFAULT_ROWER_APPEARANCE);
  });

  it('setSlot writes through the service and updates state', () => {
    const service = stubService();
    const { result } = renderHook(() => useRowerAppearance(service));
    act(() => result.current.setSlot('top', 'red'));
    expect(result.current.appearance.top).toBe('red');
    expect(service.writes.at(-1)?.top).toBe('red');
  });

  it('reset returns to the default and writes it through', () => {
    const service = stubService({ ...DEFAULT_ROWER_APPEARANCE, top: 'red' });
    const { result } = renderHook(() => useRowerAppearance(service));
    expect(result.current.appearance.top).toBe('red');
    act(() => result.current.reset());
    expect(result.current.appearance).toEqual(DEFAULT_ROWER_APPEARANCE);
    expect(service.writes.at(-1)).toEqual(DEFAULT_ROWER_APPEARANCE);
  });
});
