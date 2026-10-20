/**
 * #493 FR18: what land lies beyond each bank. The land-use areas from the
 * Overpass response, and the one a point stands in, decided by
 * point-in-polygon (G6: it used to be the bbox-nearest feature, shared by
 * both banks).
 */
import type { Coordinate } from '../types/index';
import type { OverpassElement, SceneryProfile } from '../services/routeEnrichmentService';
import { pointInPolygon, polygonsFromElement, type MaskBounds, type Polygon } from './osmWaterMask';
import { mapOsmTagsToSceneryProfile } from './sceneryFromTags';

export interface LandArea {
  profile: SceneryProfile;
  polygon: Polygon;
  extent: MaskBounds;
  /** Outer ring's area in square degrees: only compared, so the units don't matter. */
  size: number;
}

const extentOf = (ring: Coordinate[]): MaskBounds => ({
  minLat: Math.min(...ring.map((point) => point.lat)),
  maxLat: Math.max(...ring.map((point) => point.lat)),
  minLng: Math.min(...ring.map((point) => point.lng)),
  maxLng: Math.max(...ring.map((point) => point.lng)),
});

const ringArea = (ring: Coordinate[]) =>
  Math.abs(
    ring.slice(1).reduce((sum, point, index) => sum + ring[index].lng * point.lat - point.lng * ring[index].lat, 0),
  ) / 2;

/** Every closed land-use area that maps to a scenery profile. */
export const buildLandAreas = (elements: OverpassElement[]): LandArea[] =>
  elements.flatMap((element) => {
    const profile = mapOsmTagsToSceneryProfile(element.tags);
    if (profile === 'fallback') return [];
    return polygonsFromElement(element).map((polygon) => ({
      profile,
      polygon,
      extent: extentOf(polygon.outer),
      size: ringArea(polygon.outer),
    }));
  });

/**
 * The profile of the area a point stands in, or `null` for none. Where areas
 * overlap the smallest wins: a park inside a residential district is the park.
 */
export const landAt = (areas: LandArea[], point: Coordinate): SceneryProfile | null => {
  let best: LandArea | null = null;
  for (const area of areas) {
    const { extent } = area;
    if (point.lat < extent.minLat || point.lat > extent.maxLat || point.lng < extent.minLng || point.lng > extent.maxLng) continue;
    if ((!best || area.size < best.size) && pointInPolygon(point, area.polygon)) best = area;
  }
  return best?.profile ?? null;
};
