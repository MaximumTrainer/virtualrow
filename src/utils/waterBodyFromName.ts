import type { WaterBodyType } from '../services/routeEnrichmentService';

/**
 * Classify the water body of a course from its name alone.
 *
 * rownative's index gives us `id`, `name`, `country`, `distance_m` and `status`
 * — nothing that says whether the course is a lake, a canal or a river. The
 * name is the only water signal, and this classifier is the reason a course
 * called `Regatta Lake` no longer imports as an `unknown` (river-shaped)
 * route (#413).
 *
 * The trap is that "lake" is a substring of real river courses:
 * **Mortlake** is on the Tidal Thames. Whole-word matching, not substring
 * matching, is what keeps the Championship Course a river. The known cost is
 * that a lake whose name embeds its water word in a single token —
 * `Windermere`, `Coniston Water`, `Rutland Water` — falls back to `'unknown'`.
 * A test asserts this so the next reader knows it is a decision.
 */

/**
 * Highest precedence first (FR2): flowing water wins over still water so
 * `River Thames at Mortlake` classifies as river rather than lake.
 */
const VOCABULARY: ReadonlyArray<{
  type: WaterBodyType;
  words: readonly string[];
}> = [
  { type: 'canal', words: ['canal', 'canals', 'kanal', 'kanaal'] },
  { type: 'stream', words: ['stream', 'creek', 'brook', 'beck'] },
  {
    type: 'river',
    words: ['river', 'rivers', 'riviere', 'fiume', 'rio', 'fluss'],
  },
  { type: 'reservoir', words: ['reservoir', 'reservoirs'] },
  {
    type: 'lake',
    words: [
      'lake',
      'lakes',
      'loch',
      'lochs',
      'lough',
      'llyn',
      'lagoon',
      'lac',
      'lago',
      'meer',
      'jarvi',
      'tarn',
      'pond',
    ],
  },
];

/**
 * Diacritics folded (NFD then strip combining marks) so `Rivière` matches
 * `riviere`, then split on anything that is not a letter or digit. Punctuation
 * and hyphens are all word breaks, which is why `Bled (Lake)` classifies as a
 * lake and why the `Mort-lake` edge case falls through as one too.
 */
const wordsIn = (name: string): Set<string> =>
  new Set(
    name
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(Boolean),
  );

export const waterBodyFromName = (name: string): WaterBodyType => {
  const words = wordsIn(name);
  return (
    VOCABULARY.find(({ words: candidates }) =>
      candidates.some((word) => words.has(word)),
    )?.type ?? 'unknown'
  );
};
