// ============================================================================
// Crew model selection — pick the male/female sculling GLB for the rower.
//
// The rower's gender comes from the athlete's intervals.icu profile (AuthUser.
// gender, mapped from the API `sex` field). Pure and data-only so it can be
// unit-tested without the R3F scene.
// ============================================================================

export type Crew = 'male' | 'female';

/** Crewed sculling GLBs in public/assets/boat/ (issue #229). */
export const CREW_URL: Record<Crew, string> = {
  male: '/assets/boat/scull-male.glb',
  female: '/assets/boat/scull-female.glb',
};

/**
 * Resolve which crew model to show from an athlete's gender.
 * Defaults to `male` when gender is unknown (guest sessions, older profiles),
 * matching the previous single-model behaviour.
 */
export const resolveCrew = (gender?: 'male' | 'female' | null): Crew =>
  gender === 'female' ? 'female' : 'male';

/** The GLB URL for an athlete's gender. */
export const crewModelUrl = (gender?: 'male' | 'female' | null): string =>
  CREW_URL[resolveCrew(gender)];
