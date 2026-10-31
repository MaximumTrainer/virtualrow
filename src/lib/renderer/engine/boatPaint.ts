/**
 * Dynamic shell paint colour per athlete (#571).
 *
 * The pre-#571 scull always loaded with a single hard-coded off-white
 * (RGBA 0.78, 0.78, 0.82, 1.0). This picks a stable, athlete-identity-
 * driven tint from a small curated palette so the hull reads as that
 * athlete's boat across sessions.
 *
 * Pure maths — no GPU calls, no stateful side-effects — so the mapping
 * can be unit-tested in isolation and shared between the ride scene,
 * the ghost renderer, and any future paint-preview UI without racing
 * against render state.
 *
 * Palette rules of thumb:
 * - All tints sit between 0.55 and 0.95 per channel so the shell
 *   never dips into near-black (invisible against river shadow) or
 *   full white (blown out under direct sun through the composite).
 * - Each entry is a sailing-club style club colour — the kind of
 *   livery a rowing club actually paints on a shell — rather than a
 *   fully saturated primary. Keeps the look across a start-line of
 *   boats consistent.
 * - Alpha is always 1.0; the ghost scull has its own alpha path.
 */

/** The baseline tint for an unknown / empty athlete id — matches the
 *  pre-#571 constant so a caller that passes nothing sees today's look. */
export const BOAT_TINT_DEFAULT: readonly [number, number, number, number] = [
  0.78, 0.78, 0.82, 1.0,
];

/** Palette of club-style shell colours. Keep in sync with
 *  `BOAT_PAINT_PALETTE_COUNT` below — the hash picks via `index %
 *  length`, so adding or removing an entry shifts every athlete's
 *  colour. If a specific athlete needs to keep a given tint across a
 *  palette edit, override via `boatTintFromAthlete`'s manual branch. */
export const BOAT_PAINT_PALETTE: readonly (readonly [number, number, number, number])[] = [
  [0.78, 0.78, 0.82, 1.0], // off-white (default)
  [0.86, 0.65, 0.58, 1.0], // red brick
  [0.60, 0.72, 0.86, 1.0], // sky blue
  [0.68, 0.80, 0.60, 1.0], // sage green
  [0.90, 0.84, 0.60, 1.0], // sunlit yellow
  [0.78, 0.64, 0.80, 1.0], // dusky violet
  [0.60, 0.68, 0.78, 1.0], // slate
  [0.80, 0.70, 0.58, 1.0], // sandstone
  [0.70, 0.84, 0.80, 1.0], // seafoam
  [0.86, 0.72, 0.65, 1.0], // coral
];

export const BOAT_PAINT_PALETTE_COUNT = BOAT_PAINT_PALETTE.length;

/** Deterministic FNV-1a hash of a string → u32. Public so tests + the
 *  ghost renderer can derive the same number without re-implementing. */
export const hashAthleteId = (id: string): number => {
  let h = 0x811c9dc5 >>> 0;
  for (let i = 0; i < id.length; i += 1) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
};

/**
 * Pick the shell paint tint for the given athlete id. Returns a fresh
 * `Float32Array(4)` (so the caller can safely poke it into a uniform
 * buffer without aliasing with the shared palette entries).
 *
 * Empty / undefined / zero-length id → the default off-white, matching
 * the pre-#571 hard-coded constant. Any other id runs through
 * `hashAthleteId` and indexes the palette modulo its length — same id
 * always picks the same colour.
 */
export const boatTintFromAthlete = (athleteId?: string | null): Float32Array => {
  const out = new Float32Array(4);
  const src =
    !athleteId || athleteId.length === 0
      ? BOAT_TINT_DEFAULT
      : BOAT_PAINT_PALETTE[hashAthleteId(athleteId) % BOAT_PAINT_PALETTE_COUNT]!;
  out[0] = src[0];
  out[1] = src[1];
  out[2] = src[2];
  out[3] = src[3];
  return out;
};
