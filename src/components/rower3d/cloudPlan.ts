import { SCENE_CONFIG, type CloudConfig } from './themeConfig';
import type { PerformanceMode } from './constants';

/**
 * How much sky a tier can afford (#326).
 *
 * Every cloud is a drei `Cloud` built from the config's `segments` — up to forty
 * sprites each. Eight of those is three hundred and twenty transparent quads
 * across the whole sky, sorted and blended every frame, on hardware the low
 * tier exists because it could not manage shadows.
 *
 * So the tier decides how many and how detailed; the config decides what they
 * look like. Everything else passes through, because everything else is free.
 */

/** The most clouds a tier will draw, whatever the config asks for. */
const MOST_CLOUDS: Record<PerformanceMode, number> = { low: 0, auto: 6, high: 12 };

/** Segments per cloud below the top tier, where the authored count stands. */
const PLAIN_SEGMENTS = 12;

export const cloudsFor = (mode: PerformanceMode): CloudConfig => {
  const authored = SCENE_CONFIG.clouds;

  return {
    ...authored,
    count: Math.min(authored.count, MOST_CLOUDS[mode]),
    segments: mode === 'high' ? authored.segments : Math.min(authored.segments, PLAIN_SEGMENTS),
  };
};
