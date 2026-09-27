import { describe, it, expect } from 'vitest';
import { waterBodyFromName } from '../utils/waterBodyFromName';

/**
 * Issue #413 — a rownative course rowed on a lake is drawn as a river because
 * nothing classifies it as a lake. The name is the only water signal.
 */

describe('waterBodyFromName', () => {
  describe('lake', () => {
    it('matches on whole words, however punctuated (AC1.1, AC1.3)', () => {
      for (const name of [
        'Regatta Lake',
        'Lake Windermere',
        'LAKE BLED',
        'Bled (Lake)',
        'Lake, Bled',
        'Bled Lake.',
        'Lake—Bled',
        'Lake-Bled',
      ]) {
        expect(waterBodyFromName(name), name).toBe('lake');
      }
    });

    it('does not match a word that merely contains "lake" (AC1.2, AC7.3)', () => {
      for (const name of [
        'Mortlake',
        'Mortlake to Putney',
        'Lakeside Regatta',
        'Blakeney',
      ]) {
        expect(waterBodyFromName(name), name).not.toBe('lake');
      }
    });

    it('accepts the other lake vocabulary (AC3.1)', () => {
      expect(waterBodyFromName('Loch Ness')).toBe('lake');
      expect(waterBodyFromName('Lough Erne')).toBe('lake');
      expect(waterBodyFromName('Llyn Padarn')).toBe('lake');
      expect(waterBodyFromName('Lago di Bled')).toBe('lake');
      expect(waterBodyFromName('Pond of Reflection')).toBe('lake');
      expect(waterBodyFromName('Blue Lagoon')).toBe('lake');
      expect(waterBodyFromName('Malham Tarn')).toBe('lake');
    });

    it('is a known limitation that Windermere and Rutland Water are unknown (AC3.6)', () => {
      // "Windermere" and "Rutland Water" embed their water word in a single
      // token: whole-word matching is what keeps `Mortlake` a river, and
      // loosening it to catch these would catch that with it. The next
      // reader should find this decision recorded rather than treat it as an
      // oversight.
      expect(waterBodyFromName('Windermere')).toBe('unknown');
      expect(waterBodyFromName('Rutland Water')).toBe('unknown');
      expect(waterBodyFromName('Coniston Water')).toBe('unknown');
    });

    it('accepts the hyphenated compound edge (AC1.3)', () => {
      // A hyphen separates words: `Lake-Bled` matches, and so does `Mort-lake`.
      // Nobody spells Mortlake that way, and the alternative is treating `-`
      // as a letter and losing `Lake-Bled`. Recorded here as a known edge.
      expect(waterBodyFromName('Mort-lake')).toBe('lake');
    });
  });

  describe('flowing water wins over still water (FR2)', () => {
    it('classifies a river-and-lake name as a river (AC2.1)', () => {
      expect(waterBodyFromName('River Thames at Mortlake')).toBe('river');
      expect(waterBodyFromName('Lake Gorge River Course')).toBe('river');
    });

    it('follows the fixed precedence, not the order of words in the name (AC2.2)', () => {
      expect(waterBodyFromName('Regent Canal River Reach')).toBe('canal');
      expect(waterBodyFromName('River and Trout Creek Reach')).toBe('stream');
      expect(waterBodyFromName('River and Reservoir Loop')).toBe('river');
    });
  });

  describe('the other types', () => {
    it('classifies canals (AC3.4)', () => {
      expect(waterBodyFromName('Grand Union Canal')).toBe('canal');
      expect(waterBodyFromName('Nord-Ostsee-Kanal')).toBe('canal');
      expect(waterBodyFromName('Amsterdam Kanaal Circuit')).toBe('canal');
    });

    it('classifies streams (AC3.4)', () => {
      expect(waterBodyFromName('Trout Creek')).toBe('stream');
      expect(waterBodyFromName('Willow Brook')).toBe('stream');
      expect(waterBodyFromName('Cauldron Beck')).toBe('stream');
    });

    it('classifies reservoirs (AC3.2)', () => {
      expect(waterBodyFromName('Rutland Reservoir')).toBe('reservoir');
      expect(waterBodyFromName('Farmoor Reservoirs')).toBe('reservoir');
    });

    it('classifies rivers in more than English (AC3.3)', () => {
      expect(waterBodyFromName('Rio Guadiana')).toBe('river');
      expect(waterBodyFromName('Fiume Po')).toBe('river');
      expect(waterBodyFromName('Rhein Fluss')).toBe('river');
    });

    it('folds diacritics before matching (AC3.5)', () => {
      expect(waterBodyFromName('Rivière des Prairies')).toBe('river');
      expect(waterBodyFromName('Riviere des Prairies')).toBe('river');
      expect(waterBodyFromName('Järvi Regatta')).toBe('lake');
    });
  });

  describe('unknown', () => {
    it('returns unknown when nothing matches (AC1.4)', () => {
      expect(waterBodyFromName('Willowbrook River')).toBe('river'); // sanity
      expect(waterBodyFromName('Willowbrook Course')).toBe('unknown');
      expect(waterBodyFromName('Championship Course')).toBe('unknown');
    });

    it('never guesses from an empty or numeric name (AC1.4)', () => {
      expect(waterBodyFromName('')).toBe('unknown');
      expect(waterBodyFromName('   ')).toBe('unknown');
      expect(waterBodyFromName('2000m')).toBe('unknown');
    });
  });
});
