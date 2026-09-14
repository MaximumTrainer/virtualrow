import { useCallback, useState } from 'react';
import type { Crew } from '../components/rower3d/crewModel';

/**
 * Which rower the athlete wants in the boat.
 *
 * `auto` takes the gender from the intervals.icu profile, which is right for a
 * signed-in athlete who filled it in. Everyone else — guests, demo rows, and
 * any profile without a `sex` field — was silently given the male model with no
 * way to say otherwise (issue #232).
 */
export type CrewPreference = 'auto' | Crew;

export const CREW_PREFERENCE_STORAGE_KEY = 'virtualrow:crew';

export const CREW_PREFERENCE_OPTIONS: ReadonlyArray<{
  value: CrewPreference;
  label: string;
  hint: string;
}> = [
  { value: 'auto', label: 'Auto', hint: 'Match your intervals.icu profile' },
  { value: 'female', label: 'Female', hint: 'Always show the female rower' },
  { value: 'male', label: 'Male', hint: 'Always show the male rower' },
];

const isPreference = (value: unknown): value is CrewPreference =>
  value === 'auto' || value === 'female' || value === 'male';

const readStored = (): CrewPreference => {
  try {
    const stored = localStorage.getItem(CREW_PREFERENCE_STORAGE_KEY);
    return isPreference(stored) ? stored : 'auto';
  } catch {
    // Private browsing, or storage disabled. Auto is no worse for it.
    return 'auto';
  }
};

export interface CrewPreferenceControl {
  preference: CrewPreference;
  setPreference: (next: CrewPreference) => void;
}

export const useCrewPreference = (): CrewPreferenceControl => {
  const [preference, setStored] = useState<CrewPreference>(readStored);

  const setPreference = useCallback((next: CrewPreference) => {
    setStored(next);
    try {
      localStorage.setItem(CREW_PREFERENCE_STORAGE_KEY, next);
    } catch {
      // The choice still applies to this session.
    }
  }, []);

  return { preference, setPreference };
};
