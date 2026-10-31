import type { WaterBodyType } from '../services/routeEnrichmentService';

/**
 * Classify a water body from a course name (#413).
 *
 * rownative gives us `id`, `name`, `country`, `distance_m` and `status`, and
 * nothing about the water. Every rownative import falls through to `unknown`,
 * which is river-shaped in width, appearance and dressing — so a lake course
 * is drawn as a narrow river channel. The name is the only water signal, and
 * this file is the whole of what reads it.
 *
 * The trap is that "lake" is a substring of real river courses: Mortlake is
 * on the Tidal Thames. Matching on `name.includes('lake')` would move the
 * Championship Course onto a lake. This matches whole words only.
 *
 * Pure, no I/O. Used both when a rownative course is imported (to write a
 * water tag) and inside `inferRouteWaterBodyType` (so routes already stored
 * are fixed without re-importing).
 */

/**
 * Vocabulary in precedence order, highest first (FR2, AC2.2).
 *
 * Flowing water wins over still water: a name that carries both is almost
 * always the flowing one. `canal → stream → river → reservoir → lake`.
 *
 * A new water word is one entry — the resolution is data, not a chain of ifs.
 */
const VOCABULARY: ReadonlyArray<{ type: WaterBodyType; words: readonly string[] }> = [
  { type: 'canal',     words: ['canal', 'canals', 'kanal', 'kanaal'] },
  { type: 'stream',    words: ['stream', 'creek', 'brook', 'beck'] },
  { type: 'river',     words: ['river', 'rivers', 'riviere', 'fiume', 'rio', 'fluss'] },
  { type: 'reservoir', words: ['reservoir', 'reservoirs'] },
  // No entry for `Windermere`, `Coniston Water` or `Rutland Water`: a lake
  // whose name embeds its water word in a single token stays `unknown`.
  // Whole-word matching is what keeps `Mortlake` a river, and loosening it to
  // catch `Windermere` would catch `Mortlake` with it. OSM or a manual tag is
  // the route to a correct answer for those (AC3.6).
  { type: 'lake',      words: ['lake', 'lakes', 'loch', 'lochs', 'lough', 'llyn',
                               'lagoon', 'lac', 'lago', 'meer', 'jarvi', 'tarn', 'pond'] },
];

/**
 * Tokenise a name into words. Diacritics are folded first (AC3.5), then
 * anything that is not a letter or digit is a separator — so `Bled (Lake)`,
 * `Lake, Bled`, `Bled Lake.` and `Lake—Bled` all tokenise the same way. A
 * hyphenated compound counts as two words (AC1.3).
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
  return VOCABULARY.find(({ words: w }) => w.some((word) => words.has(word)))?.type ?? 'unknown';
};
