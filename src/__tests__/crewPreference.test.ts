import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  CREW_PREFERENCE_STORAGE_KEY,
  CREW_PREFERENCE_OPTIONS,
  useCrewPreference,
} from '../hooks/useCrewPreference';
import { resolveCrew } from '../components/rower3d/crewModel';

describe('resolveCrew with a stated preference', () => {
  it('shows what the rower asked for, whatever the profile says', () => {
    expect(resolveCrew('male', 'female')).toBe('female');
    expect(resolveCrew('female', 'male')).toBe('male');
  });

  it('follows the profile when the preference is auto', () => {
    expect(resolveCrew('female', 'auto')).toBe('female');
    expect(resolveCrew('male', 'auto')).toBe('male');
  });

  it('still has to choose something for a guest with no profile and no preference', () => {
    expect(resolveCrew(undefined, 'auto')).toBe('male');
  });

  it('lets that guest choose, which is the point', () => {
    expect(resolveCrew(undefined, 'female')).toBe('female');
  });

  it('keeps the old single-argument behaviour', () => {
    expect(resolveCrew('female')).toBe('female');
    expect(resolveCrew(undefined)).toBe('male');
  });
});

describe('useCrewPreference', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('offers auto plus a choice of rower', () => {
    expect(CREW_PREFERENCE_OPTIONS.map((o) => o.value)).toEqual(['auto', 'female', 'male']);
  });

  it('starts on auto', () => {
    const { result } = renderHook(() => useCrewPreference());

    expect(result.current.preference).toBe('auto');
  });

  it('remembers a choice across sessions', () => {
    const { result } = renderHook(() => useCrewPreference());

    act(() => result.current.setPreference('female'));

    expect(localStorage.getItem(CREW_PREFERENCE_STORAGE_KEY)).toBe('female');
    expect(renderHook(() => useCrewPreference()).result.current.preference).toBe('female');
  });

  it('ignores a stored value it does not recognise', () => {
    localStorage.setItem(CREW_PREFERENCE_STORAGE_KEY, 'coxed-eight');

    expect(renderHook(() => useCrewPreference()).result.current.preference).toBe('auto');
  });
});
