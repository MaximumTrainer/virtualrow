import { describe, expect, it } from 'vitest';

import { waterBodyFromName } from '../utils/waterBodyFromName';

describe('waterBodyFromName', () => {
  describe('whole-word lake matching (FR1)', () => {
    it.each([
      'Regatta Lake',
      'Lake Windermere',
      'LAKE BLED',
      'lake bled',
      'Bled (Lake)',
      'Lake, Bled',
      'Bled Lake.',
      'Lake—Bled',
      'Lake-Bled',
    ])('classifies %s as lake', (name) => {
      expect(waterBodyFromName(name)).toBe('lake');
    });

    it.each([
      'Mortlake',
      'Mortlake to Putney',
      'Lakeside Regatta',
      'Blakeney',
    ])('does not classify %s as lake', (name) => {
      expect(waterBodyFromName(name)).not.toBe('lake');
    });

    it(
      'accepts Mort-lake as a lake — an edge case of the hyphen-as-word-break rule that keeps ' +
        'Lake-Bled classifiable; nobody spells the Thames course this way, so the loss is nil',
      () => {
        expect(waterBodyFromName('Mort-lake')).toBe('lake');
      },
    );
  });

  describe('flowing water wins over still water (FR2)', () => {
    it('classifies River Thames at Mortlake as river', () => {
      expect(waterBodyFromName('River Thames at Mortlake')).toBe('river');
    });

    it('classifies Lake Gorge River Course as river', () => {
      expect(waterBodyFromName('Lake Gorge River Course')).toBe('river');
    });

    it('classifies Grand Union Canal at Riverside as canal', () => {
      expect(waterBodyFromName('Grand Union Canal at Riverside')).toBe('canal');
    });

    it('resolves canal before stream before river before reservoir before lake', () => {
      expect(waterBodyFromName('Reservoir Lake')).toBe('reservoir');
      expect(waterBodyFromName('Stream Reservoir')).toBe('stream');
      expect(waterBodyFromName('Canal Stream River')).toBe('canal');
    });
  });

  describe('vocabulary (FR3)', () => {
    it.each([
      ['Loch Ness', 'lake'],
      ['Lough Erne', 'lake'],
      ['Llyn Padarn', 'lake'],
      ['Lago di Bled', 'lake'],
      ['Lac Léman', 'lake'],
      ['Tarn Hows', 'lake'],
      ['Fiume Po', 'river'],
      ['Rio Grande', 'river'],
      ['Kanaal Course', 'canal'],
      ['Beck Brook', 'stream'],
    ] as const)('classifies %s as %s', (name, expected) => {
      expect(waterBodyFromName(name)).toBe(expected);
    });

    it('folds diacritics before matching (AC3.5)', () => {
      expect(waterBodyFromName('Rivière des Prairies')).toBe('river');
      expect(waterBodyFromName('Riviere des Prairies')).toBe('river');
    });

    it(
      'leaves Windermere, Coniston Water and Rutland Water unclassified — a known limitation, ' +
        'per AC3.6, because loosening whole-word matching to catch them would catch Mortlake too',
      () => {
        expect(waterBodyFromName('Windermere')).toBe('unknown');
        expect(waterBodyFromName('Coniston Water')).toBe('unknown');
        expect(waterBodyFromName('Rutland Water')).toBe('unknown');
      },
    );
  });

  describe('empty and non-water names (FR1.4)', () => {
    it.each(['', '   ', '2000m', 'Championship Course'])(
      'returns unknown for %j',
      (name) => {
        expect(waterBodyFromName(name)).toBe('unknown');
      },
    );
  });
});
