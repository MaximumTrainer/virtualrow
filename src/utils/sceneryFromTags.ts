/**
 * The scenery an OSM land area stands for. Here rather than in
 * routeEnrichmentService so route detection can use it from its worker
 * (#493 FR18) without pulling in the service.
 */
import type { SceneryProfile } from '../services/routeEnrichmentService';

/** Parks and other open, grassed leisure ground read as farmland's open look (#493 AC19). */
const PARKLAND = new Set(['park', 'garden', 'recreation_ground', 'golf_course', 'common']);

export const mapOsmTagsToSceneryProfile = (
  tags: Record<string, string> = {},
): SceneryProfile => {
  if (tags.landuse === 'forest' || tags.natural === 'wood') return 'forest';
  if (tags.landuse === 'residential') return 'residential';
  if (
    tags.landuse === 'commercial' ||
    tags.landuse === 'industrial' ||
    tags.building
  ) {
    return 'commercial';
  }
  if (
    tags.landuse === 'farmland' ||
    tags.landuse === 'grass' ||
    tags.landuse === 'meadow' ||
    PARKLAND.has(tags.leisure ?? '')
  ) {
    return 'farmland';
  }
  if (tags.natural === 'beach' || tags.natural === 'sand') return 'beach';
  if (tags.natural === 'wetland') return 'wetland';
  return 'fallback';
};
