import type { Coordinate, WaterRoute } from '../types/index';
import {
  calculateBearing,
  distanceBetweenLatLng,
  normalizeBearingDelta,
  routeTotalDistanceMeters,
} from '../utils/geoUtils';

export const OPEN_TOPO_DATA_BATCH_LIMIT = 100;
export const ROUTE_SEGMENT_LENGTH_METERS = 50;
export const ROUTE_ENRICHMENT_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const OPEN_TOPO_DATA_URL = 'https://api.opentopodata.org/v1/srtm30m';
export const OVERPASS_API_URL = 'https://overpass-api.de/api/interpreter';
const ROUTE_ENRICHMENT_CACHE_PREFIX = 'virtualrow:route-enrichment:';
const SCENE_SCALE = 0.1;

export type SceneryProfile =
  | 'forest'
  | 'residential'
  | 'commercial'
  | 'farmland'
  | 'beach'
  | 'wetland'
  | 'fallback';

export type WaterBodyType =
  | 'river'
  | 'canal'
  | 'stream'
  | 'lake'
  | 'reservoir'
  | 'unknown';

export interface RouteSegmentEnrichment {
  index: number;
  startMeters: number;
  endMeters: number;
  sceneryProfile: SceneryProfile;
  treeDensity: number;
  vegetationDensity: number;
  buildingDensity: number;
  objectScale: number;
  waterWidthMeters: number;
  dragMultiplier: number;
  bearing: number;
  bearingDelta: number;
}

export interface RouteEnrichmentData {
  routeId: string;
  elevations: number[];
  segmentProfiles: RouteSegmentEnrichment[];
  waterBodyType: WaterBodyType;
  waterWidthMeters: number;
  waterColor: string;
  waveIntensity: number;
  fetchedAt: number;
  source: 'network' | 'cache' | 'fallback';
}

interface CachedRouteEnrichment {
  savedAt: number;
  data: RouteEnrichmentData;
}

interface BoundingBox {
  minLat: number;
  minLng: number;
  maxLat: number;
  maxLng: number;
}

interface OverpassGeometryPoint {
  lat: number;
  lon: number;
}

export interface OverpassElement {
  type: string;
  id?: number;
  lat?: number;
  lon?: number;
  bounds?: {
    minlat: number;
    minlon: number;
    maxlat: number;
    maxlon: number;
  };
  geometry?: OverpassGeometryPoint[];
  tags?: Record<string, string>;
}

interface OverpassResponse {
  elements?: OverpassElement[];
}

interface OpenTopoDataResponse {
  results?: Array<{ elevation: number | null }>;
}

interface CacheLookupResult {
  data: RouteEnrichmentData | null;
  stale: boolean;
}

export const SCENERY_PROFILE_CONFIG: Record<
  SceneryProfile,
  Pick<
    RouteSegmentEnrichment,
    'treeDensity' | 'vegetationDensity' | 'buildingDensity' | 'objectScale'
  >
> = {
  forest: {
    treeDensity: 1,
    vegetationDensity: 0.85,
    buildingDensity: 0.05,
    objectScale: 1.15,
  },
  residential: {
    treeDensity: 0.55,
    vegetationDensity: 0.55,
    buildingDensity: 0.4,
    objectScale: 1,
  },
  commercial: {
    treeDensity: 0.15,
    vegetationDensity: 0.2,
    buildingDensity: 0.8,
    objectScale: 1.05,
  },
  farmland: {
    treeDensity: 0.22,
    vegetationDensity: 0.45,
    buildingDensity: 0.08,
    objectScale: 0.9,
  },
  beach: {
    treeDensity: 0.18,
    vegetationDensity: 0.35,
    buildingDensity: 0.04,
    objectScale: 0.95,
  },
  wetland: {
    treeDensity: 0.3,
    vegetationDensity: 0.8,
    buildingDensity: 0.03,
    objectScale: 0.92,
  },
  fallback: {
    treeDensity: 0.45,
    vegetationDensity: 0.5,
    buildingDensity: 0.1,
    objectScale: 1,
  },
};

const defaultStorage = () => {
  if (typeof window === 'undefined') return null;
  return window.localStorage;
};

export const getRouteEnrichmentCacheKey = (routeId: string) =>
  `${ROUTE_ENRICHMENT_CACHE_PREFIX}${routeId}`;

export const splitCoordinatesIntoElevationBatches = (
  coordinates: Coordinate[],
  batchSize: number = OPEN_TOPO_DATA_BATCH_LIMIT,
) => {
  const batches: Coordinate[][] = [];
  for (let index = 0; index < coordinates.length; index += batchSize) {
    batches.push(coordinates.slice(index, index + batchSize));
  }
  return batches;
};

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
  if (tags.landuse === 'farmland' || tags.landuse === 'grass') return 'farmland';
  if (tags.natural === 'beach' || tags.natural === 'sand') return 'beach';
  if (tags.natural === 'wetland') return 'wetland';
  return 'fallback';
};

export const inferWaterBodyType = (
  tags: Record<string, string> = {},
): WaterBodyType => {
  if (tags.waterway === 'river') return 'river';
  if (tags.waterway === 'canal') return 'canal';
  if (tags.waterway === 'stream') return 'stream';
  if (tags.natural === 'water') {
    if (tags.water === 'reservoir' || tags.water === 'basin') return 'reservoir';
    return 'lake';
  }
  return 'unknown';
};

export const getDefaultWaterWidthMeters = (waterBodyType: WaterBodyType) => {
  switch (waterBodyType) {
    case 'river':
      return 55;
    case 'canal':
      return 15;
    case 'stream':
      return 7;
    case 'lake':
    case 'reservoir':
      return 45;
    default:
      return 30;
  }
};

const parseWidthMeters = (widthValue?: string) => {
  if (!widthValue) return null;
  const parsed = Number.parseFloat(widthValue);
  return Number.isFinite(parsed) ? parsed : null;
};

const getWaterAppearance = (waterBodyType: WaterBodyType) => {
  switch (waterBodyType) {
    case 'canal':
      return { waterColor: '#537a94', waveIntensity: 0.78 };
    case 'stream':
      return { waterColor: '#487d88', waveIntensity: 0.92 };
    case 'lake':
    case 'reservoir':
      return { waterColor: '#3f7ea8', waveIntensity: 0.88 };
    case 'river':
      return { waterColor: '#2f6f93', waveIntensity: 1.1 };
    default:
      return { waterColor: '#3a7aa2', waveIntensity: 1 };
  }
};

export const calculateBearingDragModifier = (bearingDelta: number) => {
  if (bearingDelta <= 5) return 1;
  const clamped = Math.min(45, Math.max(5, bearingDelta));
  return 1 + ((clamped - 5) / 40) * 0.05;
};

export const calculateBearingDeltaForSegments = (bearings: number[]) =>
  bearings.map((bearing, index) =>
    index === 0 ? 0 : normalizeBearingDelta(bearings[index - 1], bearing),
  );

const interpolateCoordinateAtDistance = (
  coordinates: Coordinate[],
  distanceMeters: number,
): Coordinate => {
  if (coordinates.length === 0) return { lat: 0, lng: 0 };
  if (coordinates.length === 1 || distanceMeters <= 0) return coordinates[0];

  let travelled = 0;
  for (let index = 1; index < coordinates.length; index++) {
    const start = coordinates[index - 1];
    const end = coordinates[index];
    const segmentDistance = distanceBetweenLatLng(
      start.lat,
      start.lng,
      end.lat,
      end.lng,
    );
    if (travelled + segmentDistance >= distanceMeters && segmentDistance > 0) {
      const t = (distanceMeters - travelled) / segmentDistance;
      return {
        lat: start.lat + (end.lat - start.lat) * t,
        lng: start.lng + (end.lng - start.lng) * t,
      };
    }
    travelled += segmentDistance;
  }

  return coordinates[coordinates.length - 1];
};

export const buildBoundingBox = (
  coordinates: Coordinate[],
  marginMeters = 200,
): BoundingBox => {
  const lats = coordinates.map((coordinate) => coordinate.lat);
  const lngs = coordinates.map((coordinate) => coordinate.lng);
  const centerLat =
    lats.reduce((total, lat) => total + lat, 0) / Math.max(1, coordinates.length);
  const latMargin = marginMeters / 111320;
  const lngMargin =
    marginMeters / (111320 * Math.max(Math.cos((centerLat * Math.PI) / 180), 0.1));

  return {
    minLat: Math.min(...lats) - latMargin,
    minLng: Math.min(...lngs) - lngMargin,
    maxLat: Math.max(...lats) + latMargin,
    maxLng: Math.max(...lngs) + lngMargin,
  };
};

export const buildOverpassQuery = (coordinates: Coordinate[]) => {
  const bounds = buildBoundingBox(coordinates);
  const bbox = `${bounds.minLat},${bounds.minLng},${bounds.maxLat},${bounds.maxLng}`;

  return `
[out:json][timeout:25];
(
  way["landuse"](${bbox});
  way["natural"](${bbox});
  way["waterway"](${bbox});
  way["building"](${bbox});
  way["leisure"](${bbox});
  relation["landuse"](${bbox});
  relation["natural"](${bbox});
  relation["waterway"](${bbox});
  relation["building"](${bbox});
  relation["leisure"](${bbox});
  node["natural"](${bbox});
  node["waterway"](${bbox});
);
out geom;
`;
};

const getElementBounds = (element: OverpassElement): BoundingBox | null => {
  if (element.bounds) {
    return {
      minLat: element.bounds.minlat,
      minLng: element.bounds.minlon,
      maxLat: element.bounds.maxlat,
      maxLng: element.bounds.maxlon,
    };
  }

  if (element.geometry && element.geometry.length > 0) {
    return buildBoundingBox(
      element.geometry.map((point) => ({ lat: point.lat, lng: point.lon })),
      0,
    );
  }

  if (Number.isFinite(element.lat) && Number.isFinite(element.lon)) {
    return {
      minLat: element.lat!,
      minLng: element.lon!,
      maxLat: element.lat!,
      maxLng: element.lon!,
    };
  }

  return null;
};

const pointInBounds = (coordinate: Coordinate, bounds: BoundingBox) =>
  coordinate.lat >= bounds.minLat &&
  coordinate.lat <= bounds.maxLat &&
  coordinate.lng >= bounds.minLng &&
  coordinate.lng <= bounds.maxLng;

const findNearestFeature = (
  coordinate: Coordinate,
  elements: OverpassElement[],
): OverpassElement | null => {
  let nearest: OverpassElement | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;

  for (const element of elements) {
    const bounds = getElementBounds(element);
    if (!bounds) continue;
    if (pointInBounds(coordinate, bounds)) return element;

    const center = {
      lat: (bounds.minLat + bounds.maxLat) / 2,
      lng: (bounds.minLng + bounds.maxLng) / 2,
    };
    const distance = distanceBetweenLatLng(
      coordinate.lat,
      coordinate.lng,
      center.lat,
      center.lng,
    );
    if (distance < nearestDistance) {
      nearest = element;
      nearestDistance = distance;
    }
  }

  return nearestDistance <= 250 ? nearest : null;
};

const inferFallbackSceneryProfile = (route: WaterRoute): SceneryProfile => {
  if (route.tags.includes('forest')) return 'forest';
  if (route.tags.includes('lake')) return 'beach';
  if (route.tags.includes('urban')) return 'commercial';
  if (route.tags.includes('meadow')) return 'farmland';
  return 'fallback';
};

const inferRouteWaterBodyType = (route: WaterRoute): WaterBodyType => {
  if (route.tags.includes('canal')) return 'canal';
  if (route.tags.includes('stream')) return 'stream';
  if (route.tags.includes('lake')) return 'lake';
  if (route.tags.includes('reservoir')) return 'reservoir';
  if (route.tags.includes('river')) return 'river';
  return 'unknown';
};

export const createFallbackRouteEnrichment = (
  route: WaterRoute,
): RouteEnrichmentData => {
  const waterBodyType = inferRouteWaterBodyType(route);
  const sceneryProfile = inferFallbackSceneryProfile(route);
  const totalDistance = routeTotalDistanceMeters(route.coordinates);
  const segmentCount = Math.max(1, Math.ceil(totalDistance / ROUTE_SEGMENT_LENGTH_METERS));
  const widthMeters = getDefaultWaterWidthMeters(waterBodyType);
  const profileConfig = SCENERY_PROFILE_CONFIG[sceneryProfile];
  const segmentProfiles: RouteSegmentEnrichment[] = [];

  for (let index = 0; index < segmentCount; index++) {
    const startMeters = index * ROUTE_SEGMENT_LENGTH_METERS;
    const endMeters = Math.min(totalDistance, startMeters + ROUTE_SEGMENT_LENGTH_METERS);
    const startCoord = interpolateCoordinateAtDistance(route.coordinates, startMeters);
    const endCoord = interpolateCoordinateAtDistance(route.coordinates, endMeters);
    const bearing = calculateBearing(
      startCoord.lat,
      startCoord.lng,
      endCoord.lat,
      endCoord.lng,
    );
    const previousBearing =
      segmentProfiles[segmentProfiles.length - 1]?.bearing ?? bearing;
    const bearingDelta =
      index === 0 ? 0 : normalizeBearingDelta(previousBearing, bearing);

    segmentProfiles.push({
      index,
      startMeters,
      endMeters,
      sceneryProfile,
      waterWidthMeters: widthMeters,
      dragMultiplier: calculateBearingDragModifier(bearingDelta),
      bearing,
      bearingDelta,
      ...profileConfig,
    });
  }

  return {
    routeId: route.id,
    elevations: route.coordinates.map(() => 0),
    segmentProfiles,
    waterBodyType,
    waterWidthMeters: widthMeters,
    ...getWaterAppearance(waterBodyType),
    fetchedAt: Date.now(),
    source: 'fallback',
  };
};

export const loadCachedRouteEnrichment = (
  routeId: string,
  storage: Storage | null = defaultStorage(),
): CacheLookupResult => {
  if (!storage) {
    return { data: null, stale: false };
  }

  try {
    const raw = storage.getItem(getRouteEnrichmentCacheKey(routeId));
    if (!raw) return { data: null, stale: false };
    const parsed = JSON.parse(raw) as CachedRouteEnrichment;
    if (!parsed?.data || typeof parsed.savedAt !== 'number') {
      return { data: null, stale: false };
    }
    const stale = Date.now() - parsed.savedAt > ROUTE_ENRICHMENT_CACHE_TTL_MS;
    return {
      data: { ...parsed.data, source: 'cache' },
      stale,
    };
  } catch {
    return { data: null, stale: false };
  }
};

export const saveCachedRouteEnrichment = (
  routeId: string,
  data: RouteEnrichmentData,
  storage: Storage | null = defaultStorage(),
) => {
  if (!storage) return;
  const entry: CachedRouteEnrichment = {
    savedAt: Date.now(),
    data,
  };
  storage.setItem(getRouteEnrichmentCacheKey(routeId), JSON.stringify(entry));
};

export const getDragMultiplierForProgress = (
  segmentProfiles: RouteSegmentEnrichment[] | undefined,
  progress: number,
) => {
  if (!segmentProfiles || segmentProfiles.length === 0) return 1;

  const clampedProgress = Math.max(0, Math.min(1, progress));
  const lastIndex = segmentProfiles.length - 1;
  const scaledIndex = clampedProgress * lastIndex;
  const lowerIndex = Math.floor(scaledIndex);
  const upperIndex = Math.min(lastIndex, lowerIndex + 1);
  const blend = scaledIndex - lowerIndex;

  const lower = segmentProfiles[lowerIndex];
  const upper = segmentProfiles[upperIndex];
  return lower.dragMultiplier + (upper.dragMultiplier - lower.dragMultiplier) * blend;
};

export const getWaterWidthSceneUnitsForProgress = (
  segmentProfiles: RouteSegmentEnrichment[] | undefined,
  fallbackWidthMeters: number,
  progress: number,
) => {
  if (!segmentProfiles || segmentProfiles.length === 0) {
    return fallbackWidthMeters * SCENE_SCALE;
  }

  const clampedProgress = Math.max(0, Math.min(1, progress));
  const lastIndex = segmentProfiles.length - 1;
  const scaledIndex = clampedProgress * lastIndex;
  const lowerIndex = Math.floor(scaledIndex);
  const upperIndex = Math.min(lastIndex, lowerIndex + 1);
  const blend = scaledIndex - lowerIndex;
  const widthMeters =
    segmentProfiles[lowerIndex].waterWidthMeters +
    (segmentProfiles[upperIndex].waterWidthMeters -
      segmentProfiles[lowerIndex].waterWidthMeters) *
      blend;

  return widthMeters * SCENE_SCALE;
};

const createSegmentProfilesFromFeatures = (
  route: WaterRoute,
  elements: OverpassElement[],
): RouteSegmentEnrichment[] => {
  const fallback = createFallbackRouteEnrichment(route);
  const waterFeatures = elements.filter(
    (element) => inferWaterBodyType(element.tags) !== 'unknown',
  );
  const landFeatures = elements.filter(
    (element) => mapOsmTagsToSceneryProfile(element.tags) !== 'fallback',
  );
  const totalDistance = routeTotalDistanceMeters(route.coordinates);
  const segmentCount = Math.max(1, Math.ceil(totalDistance / ROUTE_SEGMENT_LENGTH_METERS));
  const segmentProfiles: RouteSegmentEnrichment[] = [];

  let dominantWaterBodyType = fallback.waterBodyType;
  let dominantWidth = fallback.waterWidthMeters;
  if (waterFeatures.length > 0) {
    const tags = waterFeatures[0].tags ?? {};
    dominantWaterBodyType = inferWaterBodyType(tags);
    dominantWidth =
      parseWidthMeters(tags.width) ?? getDefaultWaterWidthMeters(dominantWaterBodyType);
  }

  for (let index = 0; index < segmentCount; index++) {
    const startMeters = index * ROUTE_SEGMENT_LENGTH_METERS;
    const endMeters = Math.min(totalDistance, startMeters + ROUTE_SEGMENT_LENGTH_METERS);
    const midpoint = interpolateCoordinateAtDistance(
      route.coordinates,
      startMeters + (endMeters - startMeters) / 2,
    );
    const startCoord = interpolateCoordinateAtDistance(route.coordinates, startMeters);
    const endCoord = interpolateCoordinateAtDistance(route.coordinates, endMeters);
    const bearing = calculateBearing(
      startCoord.lat,
      startCoord.lng,
      endCoord.lat,
      endCoord.lng,
    );
    const nearestLandFeature = findNearestFeature(midpoint, landFeatures);
    const nearestWaterFeature = findNearestFeature(midpoint, waterFeatures);
    const sceneryProfile = nearestLandFeature
      ? mapOsmTagsToSceneryProfile(nearestLandFeature.tags)
      : fallback.segmentProfiles[Math.min(index, fallback.segmentProfiles.length - 1)]
          .sceneryProfile;
    const profileConfig = SCENERY_PROFILE_CONFIG[sceneryProfile];
    const waterBodyType = nearestWaterFeature
      ? inferWaterBodyType(nearestWaterFeature.tags)
      : dominantWaterBodyType;
    const widthMeters = nearestWaterFeature
      ? parseWidthMeters(nearestWaterFeature.tags?.width) ??
        getDefaultWaterWidthMeters(waterBodyType)
      : dominantWidth;

    dominantWaterBodyType = waterBodyType === 'unknown' ? dominantWaterBodyType : waterBodyType;
    dominantWidth = widthMeters;

    const previousBearing =
      segmentProfiles[segmentProfiles.length - 1]?.bearing ?? bearing;
    const bearingDelta =
      index === 0 ? 0 : normalizeBearingDelta(previousBearing, bearing);

    segmentProfiles.push({
      index,
      startMeters,
      endMeters,
      sceneryProfile,
      waterWidthMeters: widthMeters,
      dragMultiplier: calculateBearingDragModifier(bearingDelta),
      bearing,
      bearingDelta,
      ...profileConfig,
    });
  }

  return segmentProfiles;
};

export class RouteEnrichmentService {
  private readonly fetchImpl: typeof fetch;
  private readonly storage: Storage | null;
  private readonly inflight = new Map<string, Promise<RouteEnrichmentData>>();

  constructor(fetchImpl: typeof fetch = fetch, storage: Storage | null = defaultStorage()) {
    this.fetchImpl = fetchImpl;
    this.storage = storage;
  }

  readCached(routeId: string) {
    return loadCachedRouteEnrichment(routeId, this.storage);
  }

  private async fetchElevations(coordinates: Coordinate[]) {
    const batches = splitCoordinatesIntoElevationBatches(coordinates);
    const elevations: number[] = [];

    for (const [index, batch] of batches.entries()) {
      if (import.meta.env?.DEV) {
        console.debug(
          `[route-enrichment] OpenTopoData batch ${index + 1}/${batches.length} (${batch.length} points)`,
        );
      }

      const locations = batch
        .map((coordinate) => `${coordinate.lat},${coordinate.lng}`)
        .join('|');
      const response = await this.fetchImpl(
        `${OPEN_TOPO_DATA_URL}?locations=${encodeURIComponent(locations)}`,
      );
      if (!response.ok) {
        throw new Error(`OpenTopoData request failed with HTTP ${response.status}`);
      }
      const payload = (await response.json()) as OpenTopoDataResponse;
      elevations.push(
        ...(payload.results ?? []).map((result) => result.elevation ?? 0),
      );
    }

    if (import.meta.env?.DEV) {
      console.debug(
        `[route-enrichment] received ${elevations.length} elevation points`,
      );
    }

    return elevations;
  }

  private async fetchOverpassElements(coordinates: Coordinate[]) {
    const query = buildOverpassQuery(coordinates);
    const response = await this.fetchImpl(OVERPASS_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
      },
      body: `data=${encodeURIComponent(query)}`,
    });

    if (!response.ok) {
      throw new Error(`Overpass request failed with HTTP ${response.status}`);
    }

    const payload = (await response.json()) as OverpassResponse;
    return payload.elements ?? [];
  }

  async enrichRoute(route: WaterRoute): Promise<RouteEnrichmentData> {
    const cached = this.readCached(route.id);
    if (cached.data && !cached.stale) {
      return cached.data;
    }

    const inflightRequest = this.inflight.get(route.id);
    if (inflightRequest) {
      return inflightRequest;
    }

    const request = (async () => {
      const fallback = createFallbackRouteEnrichment(route);
      try {
        const [elevations, elements] = await Promise.all([
          this.fetchElevations(route.coordinates),
          this.fetchOverpassElements(route.coordinates),
        ]);
        const segmentProfiles = createSegmentProfilesFromFeatures(route, elements);
        const waterBodyType =
          segmentProfiles.find((segment) => segment.waterWidthMeters > 0)
            ? inferWaterBodyType(
                findNearestFeature(route.coordinates[0], elements)?.tags,
              )
            : fallback.waterBodyType;
        const waterWidthMeters =
          segmentProfiles[0]?.waterWidthMeters ?? fallback.waterWidthMeters;

        const enrichment: RouteEnrichmentData = {
          routeId: route.id,
          elevations,
          segmentProfiles,
          waterBodyType: waterBodyType === 'unknown' ? fallback.waterBodyType : waterBodyType,
          waterWidthMeters,
          ...getWaterAppearance(
            waterBodyType === 'unknown' ? fallback.waterBodyType : waterBodyType,
          ),
          fetchedAt: Date.now(),
          source: 'network',
        };
        saveCachedRouteEnrichment(route.id, enrichment, this.storage);
        return enrichment;
      } catch {
        return fallback;
      }
    })().finally(() => {
      this.inflight.delete(route.id);
    });

    this.inflight.set(route.id, request);
    return request;
  }
}

export const routeEnrichmentService = new RouteEnrichmentService();
