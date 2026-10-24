/**
 * Deterministic seeded PRNG, byte-identical to
 * `src/components/rower3d/helpers.ts`'s `seededRandom`. Lives here so the
 * scenery port is three-free (`helpers.ts` imports three for other utilities).
 */
export const seededRandom = (seed: number): number => {
  const s = Math.sin(seed * 9301 + 49297) * 233280;
  return s - Math.floor(s);
};
