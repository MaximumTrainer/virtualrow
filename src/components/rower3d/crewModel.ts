// ============================================================================
// Crew model selection — pick the male/female sculling GLB for the rower.
//
// The rower's gender comes from the athlete's intervals.icu profile (AuthUser.
// gender, mapped from the API `sex` field). Pure and data-only so it can be
// unit-tested without the R3F scene.
// ============================================================================

import { assetUrl } from '../../utils/assetUrl';

export type Crew = 'male' | 'female';

/**
 * Crewed sculling GLBs in public/assets/boat/ (issue #229).
 *
 * Resolved through assetUrl so they keep working under the deploy's
 * `--base=/virtualrow/app/`; written from the domain root they 404'd in
 * production while loading fine in dev (issue #251).
 */
export const CREW_URL: Record<Crew, string> = {
  male: assetUrl('/assets/boat/scull-male.glb'),
  female: assetUrl('/assets/boat/scull-female.glb'),
};

/**
 * Resolve which crew model to show.
 *
 * A stated preference wins: a guest, a demo row, or an athlete whose profile
 * has no `sex` field should not be given a rower by default with no way to
 * change it (issue #232). Without a preference the profile decides, and with
 * neither the model falls back to `male` as it always has.
 */
export const resolveCrew = (
  gender?: 'male' | 'female' | null,
  preference: 'auto' | Crew = 'auto',
): Crew => {
  if (preference !== 'auto') return preference;
  return gender === 'female' ? 'female' : 'male';
};

/**
 * The preference to feed `resolveCrew` for a given athlete (issue #443).
 *
 * A signed-in athlete whose intervals.icu profile carries a `sex` reads the
 * rower from that profile alone: the CrewPicker is hidden from them and any
 * older `virtualrow:crew` value is ignored while their gender is known. Guests,
 * demo rows and signed-in athletes without a `sex` field keep their stored
 * choice as before (that's still the fix from #232).
 */
export const effectiveCrewPreference = (
  gender?: 'male' | 'female' | null,
  stored: 'auto' | Crew = 'auto',
): 'auto' | Crew => (gender ? 'auto' : stored);

/** The GLB URL for an athlete's gender. */
export const crewModelUrl = (gender?: 'male' | 'female' | null): string =>
  CREW_URL[resolveCrew(gender)];
