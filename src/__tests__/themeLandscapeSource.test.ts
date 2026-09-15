import { describe, it, expect } from 'vitest';
import {
  THEME_CONFIG,
  themeUsesGlbScenery,
  type RouteTheme,
} from '../components/rower3d/themeConfig';

const ALL_THEMES: RouteTheme[] = [
  'willowbrook',
  'crystal-bled',
  'gothic-venice',
  'steampunk-henley',
  'dystopian-thames',
  'scifi-boston',
];

describe('landscapeSource', () => {
  it('is declared for every theme', () => {
    for (const theme of ALL_THEMES) {
      expect(THEME_CONFIG[theme].landscapeSource).toBeDefined();
    }
  });

  it('marks the realistic theme as taking the GLB kit', () => {
    expect(THEME_CONFIG.willowbrook.landscapeSource).toBe('glb-kit');
  });

  it('leaves the stylised themes on their bespoke scenes', () => {
    const bespoke = ALL_THEMES.filter((t) => t !== 'willowbrook');

    for (const theme of bespoke) {
      expect(THEME_CONFIG[theme].landscapeSource).toBe('bespoke');
    }
  });
});

describe('themeUsesGlbScenery', () => {
  it('is true for a theme dressed from the kit', () => {
    expect(themeUsesGlbScenery('willowbrook')).toBe(true);
  });

  it('is false for a theme with its own scene', () => {
    expect(themeUsesGlbScenery('scifi-boston')).toBe(false);
    expect(themeUsesGlbScenery('gothic-venice')).toBe(false);
  });

  it('falls back to the default theme for an unknown value', () => {
    expect(themeUsesGlbScenery('not-a-theme' as RouteTheme)).toBe(true);
  });
});
