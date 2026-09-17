import { describe, it, expect } from 'vitest';
import { describeImageContent, isBlankImage } from '../utils/imageContent';

/**
 * A synthetic RGB image, as {width, height, pixels} with pixels a flat
 * Uint8Array of RGB triplets — the shape a decoded PNG gives us.
 */
const make = (
  width: number,
  height: number,
  colourAt: (x: number, y: number) => [number, number, number],
) => {
  const pixels = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [r, g, b] = colourAt(x, y);
      const i = (y * width + x) * 3;
      pixels[i] = r;
      pixels[i + 1] = g;
      pixels[i + 2] = b;
    }
  }
  return { width, height, pixels };
};

const FLAT = make(200, 100, () => [17, 24, 39]);

/** The failure this exists for: a vertical fade and nothing else. */
const VERTICAL_GRADIENT = make(200, 100, (_x, y) => [
  10 + Math.round((y / 99) * 12),
  16 + Math.round((y / 99) * 18),
  25 + Math.round((y / 99) * 30),
]);

/** Gradient sky with actual content drawn over it. */
const GRADIENT_WITH_CONTENT = make(200, 100, (x, y) => {
  const base: [number, number, number] = [
    10 + Math.round((y / 99) * 12),
    16 + Math.round((y / 99) * 18),
    25 + Math.round((y / 99) * 30),
  ];
  // A hull, some banks, a few highlights — structure that varies in x.
  if (y > 60 && ((x * 7) % 23) < 6) return [180, 170, 140];
  if (y > 45 && y < 55 && x > 40 && x < 160) return [210, 205, 190];
  return base;
});

describe('isBlankImage', () => {
  it('calls a flat fill blank', () => {
    expect(isBlankImage(FLAT).blank).toBe(true);
  });

  it('calls a pure vertical gradient blank', () => {
    // This is exactly what the published hero is: a sky fade with no scene.
    // "It is a PNG and it has more than one colour" would pass it.
    const verdict = isBlankImage(VERTICAL_GRADIENT);
    expect(verdict.blank).toBe(true);
    expect(verdict.reason).toMatch(/gradient|structure/i);
  });

  it('accepts a gradient that has a scene drawn on it', () => {
    expect(isBlankImage(GRADIENT_WITH_CONTENT).blank).toBe(false);
  });

  it('measures horizontal structure, not just colour count', () => {
    // A gradient has plenty of distinct colours and no horizontal detail; that
    // difference is the whole test.
    const gradient = describeImageContent(VERTICAL_GRADIENT);
    const content = describeImageContent(GRADIENT_WITH_CONTENT);

    expect(gradient.horizontalEnergy).toBeLessThan(content.horizontalEnergy);
    expect(content.horizontalEnergy).toBeGreaterThan(1);
  });

  it('reports what it measured, so a failure says why', () => {
    const d = describeImageContent(GRADIENT_WITH_CONTENT);

    expect(d.uniqueColours).toBeGreaterThan(1);
    expect(Number.isFinite(d.horizontalEnergy)).toBe(true);
    expect(Number.isFinite(d.verticalEnergy)).toBe(true);
  });
});
