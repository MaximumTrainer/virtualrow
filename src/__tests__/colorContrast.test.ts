import { describe, expect, it } from 'vitest';
import { chromaticApart, parseHexColor } from '../utils/colorContrast';

describe('chromaticApart', () => {
  it('is zero for identical samples', () => {
    expect(chromaticApart([120, 120, 120], [120, 120, 120])).toBeCloseTo(0, 6);
  });

  it('reads two shades of the same hue as close', () => {
    expect(chromaticApart([200, 20, 20], [100, 10, 10])).toBeLessThan(0.05);
  });

  it('reads differently-hued colours as apart', () => {
    expect(chromaticApart([200, 20, 20], [20, 20, 200])).toBeGreaterThan(0.5);
  });
});

describe('parseHexColor', () => {
  it('reads a #RRGGBB hex', () => {
    expect(parseHexColor('#1E3A5F')).toEqual([30, 58, 95]);
    expect(parseHexColor('1e3a5f')).toEqual([30, 58, 95]);
  });

  it('throws on anything else', () => {
    expect(() => parseHexColor('red')).toThrow();
    expect(() => parseHexColor('#abc')).toThrow();
  });
});
