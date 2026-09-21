import { describe, it, expect } from 'vitest';
import { detectRouteTheme } from '../components/rower3d/routeTheme';
import type { WaterRoute } from '../types';

/**
 * Issue #361 — one theme, and every route gets it.
 *
 * Five of the six themes were retired: they were fantasy reskins nothing
 * reached, two of them rendered very nearly black, and between them they
 * intercepted some of the most rowed water in the world. `detectRouteTheme`
 * matched a bare `thames`, `venice`, `charles`, `henley` and `boston` in a
 * route name, so a rownative course on the Tideway, the Charles or Henley
 * Reach was dressed as a flooded dystopia, a tesseract or a steampunk regatta.
 *
 * This is the behaviour the retirement *adds* rather than removes, which is
 * why it is tested here and why the resolver moved out of `Rower3D.tsx` to get
 * here: that file is excluded from coverage, so a pure function living in it
 * was a pure function nothing measured.
 */

const route = (name: string, tags: string[] = []): WaterRoute =>
  ({ name, tags }) as unknown as WaterRoute;

describe('detectRouteTheme', () => {
  it('dresses the demo route as willowbrook', () => {
    expect(
      detectRouteTheme(
        route('Willowbrook River', [
          'river', 'scenic', 'nature', 'varied-terrain', 'beginner-friendly',
          'forest', 'meadow', 'village', 'lake',
        ]),
      ),
    ).toBe('willowbrook');
  });

  // The venues the retired themes used to intercept. Each of these is a real
  // stretch of water a rownative course is named for.
  it.each([
    ['Championship Course, Putney to Mortlake', ['river']],
    ['Head of the Charles', ['regatta']],
    ['Henley Royal Regatta', ['regatta']],
  ])('gives %s the one surviving theme', (name, tags) => {
    expect(detectRouteTheme(route(name, tags))).toBe('willowbrook');
  });

  // The retired themes' own trigger words and tags, which must now select
  // nothing in particular.
  it.each([
    ['Venezia Perdute', ['gothic']],
    ['Iron Sovereign Gauntlet', ['steampunk']],
    ['Leviathan Reach', ['kaiju']],
    ['Lake Bled Sanctum', ['elven']],
    ['The Architect’s Equation', ['sci-fi']],
  ])('no longer selects a retired theme for %s', (name, tags) => {
    expect(detectRouteTheme(route(name, tags))).toBe('willowbrook');
  });

  it('copes with a route that names and tags nothing', () => {
    expect(detectRouteTheme({} as WaterRoute)).toBe('willowbrook');
  });
});
