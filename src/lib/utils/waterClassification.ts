// ============================================================================
// ROUTE WATER TYPE FROM DETECTION (#493 FR18, D12, D13, D24)
//
// The route's water type used to come from the first OSM feature whose bbox
// held the route's first point, or from the route's tags and name. This reads
// it from what the detected samples are actually on: each on-water sample
// votes with the type of its water area, and the route takes the majority
// (D24 c).
//
// An area's own tags decide its type. A bare natural=water (common for canal
// and harbour sections) has none, so the waterway line running through it
// decides, else it is a lake. Open water (D12 c) is the sea, bays and straits
// with open water to one side at least, and any lake where neither shore is
// in view (D13). Coastline sea between two shores in view is a tidal river.
// ============================================================================

import type { Coordinate } from '../types/index';
import type { OverpassElement, WaterBodyType } from '../services/routeEnrichmentService';
import type { MaskFeature, WaterMask } from './osmWaterMask';
import type { DetectedSample } from './shoreDetection';

/** How far from a sample the waterway line naming a bare natural=water may be. */
const LINE_SEARCH_METERS = 100;

const METRES_PER_DEGREE = 111_320;

/** The type an area's own tags give it, or `null` for a bare natural=water. */
export const waterTypeOfArea = ({ tags }: MaskFeature): WaterBodyType | null => {
  if (tags.natural === 'coastline' || tags.natural === 'bay' || tags.natural === 'strait') return 'open_water';
  if (tags.waterway === 'riverbank') return 'river';
  if (tags.waterway === 'dock' || tags.waterway === 'boatyard') return 'canal';
  if (tags.landuse === 'reservoir' || tags.landuse === 'basin') return 'reservoir';
  switch (tags.water) {
    case 'river':
    case 'oxbow':
      return 'river';
    case 'canal':
    case 'lock':
    case 'harbour':
      return 'canal';
    case 'stream':
      return 'stream';
    case 'reservoir':
    case 'basin':
      return 'reservoir';
    case undefined:
      return null;
    default:
      return 'lake';
  }
};

const LINE_TYPES: Partial<Record<string, WaterBodyType>> = {
  river: 'river',
  canal: 'canal',
  stream: 'stream',
};

const distanceToPolylineMeters = (point: Coordinate, line: Array<{ lat: number; lon: number }>) => {
  const scale = METRES_PER_DEGREE * Math.cos((point.lat * Math.PI) / 180);
  const toXY = ({ lat, lon }: { lat: number; lon: number }) => ({
    x: (lon - point.lng) * scale,
    y: (lat - point.lat) * METRES_PER_DEGREE,
  });
  let best = Infinity;
  for (let index = 1; index < line.length; index++) {
    const a = toXY(line[index - 1]);
    const b = toXY(line[index]);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lengthSquared = dx * dx + dy * dy;
    const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, -(a.x * dx + a.y * dy) / lengthSquared));
    best = Math.min(best, Math.hypot(a.x + t * dx, a.y + t * dy));
  }
  return best;
};

const lineTypeNear = (point: Coordinate, lines: OverpassElement[]): WaterBodyType | null => {
  let best: { type: WaterBodyType; distance: number } | null = null;
  for (const line of lines) {
    const type = LINE_TYPES[line.tags?.waterway ?? ''];
    if (!type || !line.geometry) continue;
    const distance = distanceToPolylineMeters(point, line.geometry);
    if (distance <= LINE_SEARCH_METERS && (!best || distance < best.distance)) best = { type, distance };
  }
  return best?.type ?? null;
};

/** The type of the water a sample is on, by its area's tags or the waterway line through it. */
const areaTypeAt = (sample: DetectedSample, feature: MaskFeature, lines: OverpassElement[]): WaterBodyType =>
  waterTypeOfArea(feature) ?? lineTypeNear(sample.coordinate, lines) ?? 'lake';

const sampleType = (
  sample: DetectedSample,
  feature: MaskFeature,
  lines: OverpassElement[],
): WaterBodyType => {
  const type = areaTypeAt(sample, feature, lines);
  const leftInView = sample.leftShoreMeters !== null;
  const rightInView = sample.rightShoreMeters !== null;
  // D13: a lake you can't see across rows like open water.
  if (type === 'lake' && !leftInView && !rightInView) return 'open_water';
  // OSM's coastline runs up tidal rivers to the tidal limit (the Clyde's reaches
  // Glasgow), so coastline sea with a shore in view on both sides is an estuary:
  // a river. A mapped bay or strait says what it is, however narrow.
  if (feature.tags.natural === 'coastline' && leftInView && rightInView) return 'river';
  return type;
};

export interface RouteWaterClass {
  waterBodyType: WaterBodyType;
  /** Share of on-water samples of each type, for telemetry (FR22). */
  shares: Partial<Record<WaterBodyType, number>>;
}

export const classifyDetectedRoute = (
  samples: DetectedSample[],
  mask: WaterMask,
  elements: OverpassElement[],
): RouteWaterClass => {
  const features = new Map(mask.water.map((feature) => [feature.id, feature]));
  const lines = elements.filter((element) => element.type === 'way' && LINE_TYPES[element.tags?.waterway ?? '']);
  const counts = new Map<WaterBodyType, number>();
  let total = 0;
  for (const sample of samples) {
    const feature = sample.kind === 'water' && sample.featureId ? features.get(sample.featureId) : undefined;
    if (!feature) continue;
    const type = sampleType(sample, feature, lines);
    counts.set(type, (counts.get(type) ?? 0) + 1);
    total += 1;
  }
  if (total === 0) return { waterBodyType: 'unknown', shares: {} };
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  return {
    waterBodyType: ranked[0][0],
    shares: Object.fromEntries(ranked.map(([type, count]) => [type, count / total])),
  };
};

const LAKE_TYPES: ReadonlySet<WaterBodyType> = new Set(['lake', 'reservoir']);

/**
 * The lake and reservoir areas the route is on (#493 Phase 3, D2 a, D5 a): the
 * water drawn by its outline. An area counts when most of the samples on it
 * read it as a lake, before D13 turns mid-lake samples into open water, so a
 * lake stays one lake however wide it gets. In id order, like the mask.
 */
export const lakeFeaturesOf = (samples: DetectedSample[], mask: WaterMask, elements: OverpassElement[]): MaskFeature[] => {
  const lines = elements.filter((element) => element.type === 'way' && LINE_TYPES[element.tags?.waterway ?? '']);
  const votes = new Map<string, number>();
  for (const sample of samples) {
    if (sample.kind !== 'water' || !sample.featureId) continue;
    const feature = mask.water.find((candidate) => candidate.id === sample.featureId);
    if (!feature) continue;
    votes.set(feature.id, (votes.get(feature.id) ?? 0) + (LAKE_TYPES.has(areaTypeAt(sample, feature, lines)) ? 1 : -1));
  }
  return mask.water.filter((feature) => (votes.get(feature.id) ?? 0) > 0);
};
