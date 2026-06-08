import type { Coordinate } from '../types/index';
import { distanceBetweenLatLng } from '../utils/geoUtils';

// OpenTopoData API endpoint for SRTM 30m elevation data
const OPENTOPO_API_URL = 'https://api.opentopodata.org/v1/srtm30m';

// OSM Overpass API endpoint
const OVERPASS_API_URL = 'https://overpass-api.de/api/interpreter';

// Cache TTL: 7 days in milliseconds
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// Maximum points per OpenTopoData batch request
const ELEVATION_BATCH_SIZE = 100;

// Margin around route bounding box for OSM queries (meters)
const OSM_QUERY_MARGIN_M = 200;

/**
 * Scenery profile types derived from OSM tags
 */
export type SceneryProfile =
  | 'dense-forest'
  | 'residential'
  | 'commercial'
  | 'farmland'
  | 'beach'
  | 'wetland'
  | 'default';

/**
 * Water body types from OSM
 */
export type WaterBodyType = 'river' | 'canal' | 'lake' | 'stream' | 'unknown';

/**
 * OSM feature data for a route segment
 */
export interface OSMFeature {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  tags: Record<string, string>;
  geometry?: Array<{ lat: number; lon: number }>;
}

/**
 * Enrichment data for a single route coordinate
 */
export interface RoutePointEnrichment {
  elevation?: number; // meters above sea level
  sceneryProfile: SceneryProfile;
  waterBodyType: WaterBodyType;
  bankWidth?: number; // meters
}

/**
 * Complete enrichment data for a route
 */
export interface RouteEnrichment {
  routeId: string;
  points: RoutePointEnrichment[];
  osmFeatures: OSMFeature[];
  waterBodyType: WaterBodyType;
  defaultBankWidth: number;
  cachedAt: number; // timestamp
}

/**
 * Cache entry structure
 */
interface CacheEntry {
  data: RouteEnrichment;
  timestamp: number;
}

/**
 * Maps OSM tags to VirtualRow scenery profiles
 */
export function osmTagsToSceneryProfile(tags: Record<string, string>): SceneryProfile {
  // Forest/woods - dense trees
  if (tags.landuse === 'forest' || tags.natural === 'wood') {
    return 'dense-forest';
  }

  // Residential - mixed trees + buildings
  if (tags.landuse === 'residential') {
    return 'residential';
  }

  // Commercial/industrial - buildings, low vegetation
  if (tags.landuse === 'commercial' || tags.landuse === 'industrial') {
    return 'commercial';
  }

  // Farmland/grass - sparse vegetation, open fields
  if (tags.landuse === 'farmland' || tags.landuse === 'grass' || tags.landuse === 'meadow') {
    return 'farmland';
  }

  // Beach/sand - sandy texture, palms/reeds
  if (tags.natural === 'beach' || tags.natural === 'sand') {
    return 'beach';
  }

  // Wetland - reeds, low scrub
  if (tags.natural === 'wetland') {
    return 'wetland';
  }

  return 'default';
}

/**
 * Determines water body type from OSM waterway tags
 */
export function osmTagsToWaterBodyType(tags: Record<string, string>): WaterBodyType {
  if (tags.waterway === 'river') return 'river';
  if (tags.waterway === 'canal') return 'canal';
  if (tags.waterway === 'stream') return 'stream';
  if (tags.natural === 'water') {
    // Check if it's a lake/reservoir
    if (tags.water === 'lake' || tags.water === 'reservoir') return 'lake';
  }
  return 'unknown';
}

/**
 * Gets default bank width for a water body type
 */
export function getDefaultBankWidth(waterBodyType: WaterBodyType, osmWidth?: string): number {
  // Try to parse OSM width attribute first
  if (osmWidth) {
    const parsed = parseFloat(osmWidth);
    if (!isNaN(parsed) && parsed > 0) {
      return parsed;
    }
  }

  // Fall back to type defaults
  switch (waterBodyType) {
    case 'river':
      return 55; // 30-80m range, use middle
    case 'canal':
      return 15; // 10-20m range, use middle
    case 'stream':
      return 7.5; // 5-10m range, use middle
    case 'lake':
      return 100; // Variable, use larger default
    default:
      return 40; // Reasonable default for unknown
  }
}

/**
 * Calculates bounding box for coordinates with margin
 */
export function calculateBoundingBox(
  coordinates: Coordinate[],
  marginMeters = OSM_QUERY_MARGIN_M,
): { minLat: number; maxLat: number; minLng: number; maxLng: number } {
  if (coordinates.length === 0) {
    throw new Error('Cannot calculate bounding box for empty coordinates');
  }

  let minLat = coordinates[0].lat;
  let maxLat = coordinates[0].lat;
  let minLng = coordinates[0].lng;
  let maxLng = coordinates[0].lng;

  for (const coord of coordinates) {
    minLat = Math.min(minLat, coord.lat);
    maxLat = Math.max(maxLat, coord.lat);
    minLng = Math.min(minLng, coord.lng);
    maxLng = Math.max(maxLng, coord.lng);
  }

  // Convert margin from meters to approximate degrees
  // At equator: 1 degree lat ≈ 111km, 1 degree lng varies by latitude
  const latMargin = marginMeters / 111000;
  const avgLat = (minLat + maxLat) / 2;
  const cosLat = Math.max(Math.abs(Math.cos((avgLat * Math.PI) / 180)), 0.01);
  const lngMargin = Math.min(marginMeters / (111000 * cosLat), 180);

  return {
    minLat: minLat - latMargin,
    maxLat: maxLat + latMargin,
    minLng: minLng - lngMargin,
    maxLng: maxLng + lngMargin,
  };
}

/**
 * RouteEnrichmentService handles geospatial data enrichment for routes
 */
export class RouteEnrichmentService {
  private readonly fetchImpl: typeof fetch;
  private readonly cacheKeyPrefix = 'vr_route_enrichment_';
  private readonly backgroundRefreshes = new Set<string>();

  constructor(fetchImpl: typeof fetch = fetch) {
    this.fetchImpl = fetchImpl;
  }

  /**
   * Gets cached enrichment data if available and not stale
   */
  private getCachedEnrichment(routeId: string): { data: RouteEnrichment; isStale: boolean } | null {
    try {
      const cached = localStorage.getItem(this.cacheKeyPrefix + routeId);
      if (!cached) return null;

      const entry: CacheEntry = JSON.parse(cached);
      const age = Date.now() - entry.timestamp;
      return {
        data: entry.data,
        isStale: age > CACHE_TTL_MS,
      };
    } catch {
      return null;
    }
  }

  /**
   * Saves enrichment data to cache
   */
  private setCachedEnrichment(routeId: string, data: RouteEnrichment): void {
    try {
      const entry: CacheEntry = {
        data,
        timestamp: Date.now(),
      };
      localStorage.setItem(this.cacheKeyPrefix + routeId, JSON.stringify(entry));
    } catch {
      // Ignore localStorage errors (quota exceeded, etc.)
    }
  }

  /**
   * Fetches elevation data from OpenTopoData API in batches
   */
  async fetchElevationData(coordinates: Coordinate[]): Promise<Array<number | undefined>> {
    const elevations: Array<number | undefined> = [];

    // Process in batches of 100 points (API limit)
    for (let i = 0; i < coordinates.length; i += ELEVATION_BATCH_SIZE) {
      const batch = coordinates.slice(i, i + ELEVATION_BATCH_SIZE);
      const locations = batch.map((c) => `${c.lat},${c.lng}`).join('|');

      try {
        const response = await this.fetchImpl(`${OPENTOPO_API_URL}?locations=${encodeURIComponent(locations)}`);
        if (!response.ok) {
          throw new Error(`OpenTopoData API returned ${response.status}`);
        }

        const data = (await response.json()) as {
          results: Array<{ elevation: number | null }>;
        };

        for (const result of data.results) {
          elevations.push(result.elevation ?? undefined);
        }
      } catch (error) {
        console.warn(
          `[RouteEnrichment] OpenTopoData batch ${Math.floor(i / ELEVATION_BATCH_SIZE) + 1} failed:`,
          error,
        );
        // Fill with undefined for failed batch
        for (let j = 0; j < batch.length; j++) {
          elevations.push(undefined);
        }
      }
    }

    return elevations;
  }

  /**
   * Queries OSM Overpass API for features in route bounding box
   */
  async fetchOSMFeatures(coordinates: Coordinate[]): Promise<OSMFeature[]> {
    const bbox = calculateBoundingBox(coordinates);

    // Overpass QL query for landuse, natural, waterway, building, leisure tags
    const query = `
      [out:json][timeout:25];
      (
        way["landuse"](${bbox.minLat},${bbox.minLng},${bbox.maxLat},${bbox.maxLng});
        relation["landuse"](${bbox.minLat},${bbox.minLng},${bbox.maxLat},${bbox.maxLng});
        way["natural"](${bbox.minLat},${bbox.minLng},${bbox.maxLat},${bbox.maxLng});
        relation["natural"](${bbox.minLat},${bbox.minLng},${bbox.maxLat},${bbox.maxLng});
        way["waterway"](${bbox.minLat},${bbox.minLng},${bbox.maxLat},${bbox.maxLng});
        relation["waterway"](${bbox.minLat},${bbox.minLng},${bbox.maxLat},${bbox.maxLng});
        way["building"](${bbox.minLat},${bbox.minLng},${bbox.maxLat},${bbox.maxLng});
        relation["building"](${bbox.minLat},${bbox.minLng},${bbox.maxLat},${bbox.maxLng});
        way["leisure"](${bbox.minLat},${bbox.minLng},${bbox.maxLat},${bbox.maxLng});
        relation["leisure"](${bbox.minLat},${bbox.minLng},${bbox.maxLat},${bbox.maxLng});
      );
      out geom;
    `.trim();

    try {
      const response = await this.fetchImpl(OVERPASS_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain;charset=UTF-8',
        },
        body: query,
      });

      if (!response.ok) {
        throw new Error(`Overpass API returned ${response.status}`);
      }

      const data = (await response.json()) as {
        elements: Array<{
          type: string;
          id: number;
          lat?: number;
          lon?: number;
          tags?: Record<string, string>;
          geometry?: Array<{ lat: number; lon: number }>;
        }>;
      };

      return data.elements.map((el) => ({
        type: el.type as 'node' | 'way' | 'relation',
        id: el.id,
        lat: el.lat,
        lon: el.lon,
        tags: el.tags || {},
        geometry: el.geometry,
      }));
    } catch (error) {
      console.warn('[RouteEnrichment] Overpass API query failed:', error);
      return [];
    }
  }

  /**
   * Determines the dominant water body type and width from OSM features
   */
  private determineWaterBodyType(osmFeatures: OSMFeature[]): { type: WaterBodyType; width?: string } {
    const waterwayFeatures = osmFeatures.filter((f) => f.tags.waterway || f.tags.natural === 'water');

    if (waterwayFeatures.length === 0) {
      return { type: 'unknown' };
    }

    // Count occurrences of each recognized type
    const typeCounts = new Map<WaterBodyType, number>();
    const unknownFeatures: OSMFeature[] = [];
    const widthByType = new Map<WaterBodyType, string>();

    for (const feature of waterwayFeatures) {
      const type = osmTagsToWaterBodyType(feature.tags);
      if (type === 'unknown') {
        unknownFeatures.push(feature);
        continue;
      }
      typeCounts.set(type, (typeCounts.get(type) || 0) + 1);

      // Store the first width found for each type
      if (feature.tags.width && !widthByType.has(type)) {
        widthByType.set(type, feature.tags.width);
      }
    }

    if (typeCounts.size === 0) {
      const firstUnknownWithWidth = unknownFeatures.find((f) => Boolean(f.tags.width));
      return {
        type: 'unknown',
        width: firstUnknownWithWidth?.tags.width,
      };
    }

    // Return most common recognized type
    let maxCount = 0;
    let dominantType: WaterBodyType = 'unknown';
    for (const [type, count] of typeCounts) {
      if (count > maxCount) {
        maxCount = count;
        dominantType = type;
      }
    }

    return {
      type: dominantType,
      width: widthByType.get(dominantType),
    };
  }

  /**
   * Assigns scenery profiles to route points based on OSM features
   */
  private assignSceneryProfiles(coordinates: Coordinate[], osmFeatures: OSMFeature[]): SceneryProfile[] {
    const profiles: SceneryProfile[] = new Array(coordinates.length).fill('default');

    // For each coordinate, find nearby OSM features and determine profile
    // This is a simplified implementation - in production you'd use spatial indexing
    for (let i = 0; i < coordinates.length; i++) {
      const coord = coordinates[i];
      let bestProfile: SceneryProfile = 'default';
      let minDistance = Infinity;

      // Find closest feature to this coordinate
      for (const feature of osmFeatures) {
        if (!feature.geometry || feature.geometry.length === 0) continue;

        // Check distance to feature geometry
        for (const point of feature.geometry) {
          const distance = distanceBetweenLatLng(coord.lat, coord.lng, point.lat, point.lon);

          if (distance < minDistance) {
            minDistance = distance;
            bestProfile = osmTagsToSceneryProfile(feature.tags);
          }
        }
      }

      profiles[i] = bestProfile;
    }

    return profiles;
  }

  /**
   * Enriches a route with geospatial data
   * @param routeId - Unique identifier for the route
   * @param coordinates - GPS coordinates of the route
   * @returns Promise resolving to enrichment data
   */
  async enrichRoute(routeId: string, coordinates: Coordinate[]): Promise<RouteEnrichment> {
    // Check cache first
    const cached = this.getCachedEnrichment(routeId);
    if (cached) {
      if (cached.isStale) {
        console.log(`[RouteEnrichment] Using stale cache for route ${routeId}, refreshing in background...`);
        void this.refreshEnrichmentInBackground(routeId, coordinates);
      }
      console.log(`[RouteEnrichment] Using cached data for route ${routeId}`);
      return cached.data;
    }

    return this.fetchAndCacheEnrichment(routeId, coordinates);
  }

  private async fetchAndCacheEnrichment(routeId: string, coordinates: Coordinate[]): Promise<RouteEnrichment> {
    console.log(`[RouteEnrichment] Fetching enrichment data for route ${routeId}...`);

    // Fetch elevation and OSM data in parallel
    const [elevations, osmFeatures] = await Promise.all([this.fetchElevationData(coordinates), this.fetchOSMFeatures(coordinates)]);

    console.log(`[RouteEnrichment] Received ${elevations.length} elevation points, ${osmFeatures.length} OSM features`);

    // Determine water body type and default bank width
    const waterBodyInfo = this.determineWaterBodyType(osmFeatures);
    const waterBodyType = waterBodyInfo.type;
    const defaultBankWidth = getDefaultBankWidth(waterBodyType, waterBodyInfo.width);

    // Assign scenery profiles to each coordinate
    const sceneryProfiles = this.assignSceneryProfiles(coordinates, osmFeatures);

    // Build enrichment data
    const points: RoutePointEnrichment[] = coordinates.map((_coord, i) => ({
      elevation: elevations[i],
      sceneryProfile: sceneryProfiles[i],
      waterBodyType,
      bankWidth: defaultBankWidth,
    }));

    const enrichment: RouteEnrichment = {
      routeId,
      points,
      osmFeatures,
      waterBodyType,
      defaultBankWidth,
      cachedAt: Date.now(),
    };

    // Cache the result
    this.setCachedEnrichment(routeId, enrichment);

    return enrichment;
  }

  private async refreshEnrichmentInBackground(routeId: string, coordinates: Coordinate[]): Promise<void> {
    if (this.backgroundRefreshes.has(routeId)) {
      return;
    }

    this.backgroundRefreshes.add(routeId);
    try {
      await this.fetchAndCacheEnrichment(routeId, coordinates);
    } catch {
      // Keep stale cache if background refresh fails
    } finally {
      this.backgroundRefreshes.delete(routeId);
    }
  }

  /**
   * Clears cached enrichment data for a specific route
   */
  clearCache(routeId: string): void {
    localStorage.removeItem(this.cacheKeyPrefix + routeId);
  }

  /**
   * Clears all cached enrichment data
   */
  clearAllCache(): void {
    const keys = Object.keys(localStorage);
    for (const key of keys) {
      if (key.startsWith(this.cacheKeyPrefix)) {
        localStorage.removeItem(key);
      }
    }
  }
}

export const routeEnrichmentService = new RouteEnrichmentService();
