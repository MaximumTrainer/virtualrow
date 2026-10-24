/**
 * Which rower the athlete wants in the boat (issue #232) — Svelte-runes port of
 * the React `useCrewPreference` hook.
 *
 * `auto` takes the gender from the intervals.icu profile. Since #443 the picker
 * only shows for guests, demo rows and profiles without a `sex` field; the
 * stored value is kept in `virtualrow:crew` regardless, so it still applies to
 * a guest / demo row in the same browser after a signed-in session.
 */
import type { Crew } from '../../components/rower3d/crewModel';

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

export class CrewPreferenceStore {
  preference = $state<CrewPreference>(readStored());

  setPreference(next: CrewPreference): void {
    this.preference = next;
    try {
      localStorage.setItem(CREW_PREFERENCE_STORAGE_KEY, next);
    } catch {
      // The choice still applies to this session.
    }
  }
}
