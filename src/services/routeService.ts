import type { WaterRoute, Coordinate, RouteFormData } from '../types/index';
import {
  willowbrookRiverCoordinates,
} from '../data/seedRouteCoordinates';
import {
  parseKMLCoordinateList,
  polylineLengthMeters,
  resampleCoordinates,
} from '../utils/coordinateUtils';
import { parseGeoJsonTrack, parseGpxTrack } from '../utils/trackParsers';
import type { GeometrySource } from '../types/index';

/**
 * Maximum spacing between consecutive points on an imported route.
 *
 * Matches the bundled Willowbrook demo route (~50 m between points), which is
 * the density the 3D camera and progress tracking were tuned against.
 * rownative courses arrive as start/finish gate centroids — sometimes only two
 * points for a 5 km course — so they are densified to this before reaching the
 * engine. See issue #189.
 */
export const IMPORT_RESAMPLE_MAX_GAP_M = 50;

/**
 * Tag marking a route whose geometry is nothing but gate centroids.
 *
 * Kept as an alias for `geometrySource === 'gate-chain'` so anything filtering
 * on it before issue #194 still works. Point count no longer decides it: a
 * 35-gate course is still gates-only, and a 9-point attached track is not.
 */
export const OUTLINE_ONLY_TAG = 'outline-only';

/** Prefix of the tag that records where a route's geometry came from. */
export const GEOMETRY_SOURCE_TAG_PREFIX = 'geometry:';

/**
 * Show rownative's own distance alongside ours once the two differ by more
 * than this fraction. Their figure is a straight-line gate chain by
 * definition, so a meandering river routinely lands well outside it.
 *
 * R-11 proposes 15 %, but issue #194's own open question asks whether that is
 * too high — and it is: Castle to Crane, the case AC-10 names, is 12 % out
 * (21.95 km of river against a 19.6 km straight line) and would be hidden.
 * 10 % still leaves every gate-chain course quiet, where the two figures
 * agree to within a percent by construction.
 */
export const DISTANCE_DISCREPANCY_THRESHOLD = 0.10;

/** A parsed KML placemark with its coordinate sequence, ready to import as a route. */
export interface KMLImportCandidate {
  name: string;
  description: string;
  coordinates: Coordinate[];
}

export interface RownativeRouteImportData {
  id: string;
  name: string;
  country: string;
  /** The resolved polyline. Its length is the route's distance. */
  coordinates: Coordinate[];
  /** Where `coordinates` came from. Drives the badge and the outline-only tag. */
  geometrySource: GeometrySource;
  /** rownative's own `distance_m`, kept for display only. */
  externalDistanceMeters?: number;
  status?: string;
}

/**
 * Discriminated union returned by importRouteFromKML:
 * - success: exactly one route was found and created
 * - error: the file could not be parsed or contained no valid routes
 * - selectionRequired: multiple placemarks found; caller must let the user choose one
 *   via finalizeKMLImport()
 */
export type KMLImportResult =
  | { status: 'success'; route: WaterRoute }
  | { status: 'error'; error: string }
  | { status: 'selectionRequired'; candidates: KMLImportCandidate[] };


// Data service for water routes
export class RouteService {
  private routes: WaterRoute[] = [];

  constructor() {
    this.initializeMockRoutes();
  }

  private initializeMockRoutes(): void {
    // Initialize with the single built-in demo route; additional rownative routes
    // are still added dynamically via importRouteFromRownative().
    this.routes = [
      {
        id: '1',
        name: 'Willowbrook River',
        description: 'A scenic 5km journey down the meandering Willowbrook River. Begin in the forested highlands, glide through open wildflower meadows, navigate the rocky narrows, pass the quaint village waterfront, and finish where the river opens into a tranquil lake delta. The landscape transforms dramatically as you progress downstream.',
        distance: 5.0,
        difficulty: 'easy',
        location: 'Willowbrook Valley',
        coordinates: willowbrookRiverCoordinates,
        elevationGain: 15, // Gentle downhill flow
        estimatedTime: Math.round((5.0 / 3.5) * 60), // ~86 minutes at average pace
        tags: ['river', 'scenic', 'nature', 'varied-terrain', 'beginner-friendly', 'forest', 'meadow', 'village', 'lake'],
        createdAt: new Date('2024-12-07'),
      },
    ];
  }

  getAllRoutes(): WaterRoute[] {
    return [...this.routes];
  }

  getRouteById(id: string): WaterRoute | undefined {
    return this.routes.find((route) => route.id === id);
  }

  searchRoutes(query: string): WaterRoute[] {
    const lowerQuery = query.toLowerCase();
    return this.routes.filter(
      (route) =>
        route.name.toLowerCase().includes(lowerQuery) ||
        route.location.toLowerCase().includes(lowerQuery) ||
        route.tags.some((tag) => tag.toLowerCase().includes(lowerQuery))
    );
  }

  filterRoutesByDifficulty(difficulty: 'easy' | 'moderate' | 'hard'): WaterRoute[] {
    return this.routes.filter((route) => route.difficulty === difficulty);
  }

  filterRoutesByDistance(minKm: number, maxKm: number): WaterRoute[] {
    return this.routes.filter(
      (route) => route.distance >= minKm && route.distance <= maxKm
    );
  }

  createRoute(data: RouteFormData): WaterRoute {
    const distanceKm = data.distanceKm ?? this.calculateRouteDistance(data.coordinates);
    const newRoute: WaterRoute = {
      id: Date.now().toString(),
      name: data.name,
      description: data.description,
      distance: distanceKm,
      difficulty: data.difficulty,
      location: data.location,
      coordinates: data.coordinates,
      elevationGain: 0, // Would be calculated from elevation data
      estimatedTime: data.estimatedTimeMin ?? Math.round((distanceKm / 3.5) * 60), // Rough estimate
      imageUrl: data.imageUrl,
      tags: data.tags,
      createdAt: new Date(),
      source: data.source,
      externalId: data.externalId,
      geometrySource: data.geometrySource,
      externalDistanceMeters: data.externalDistanceMeters,
    };

    this.routes.push(newRoute);
    return newRoute;
  }

  // Parse GPX XML into coordinates (trkpt or rtept)
  private parseGPX(gpxXml: string): Coordinate[] {
    // Shared with the rownative track-attach flow so both read a file the same way.
    try {
      return parseGpxTrack(gpxXml);
    } catch {
      return [];
    }
  }

  // Parse GeoJSON string into coordinates (LineString / MultiLineString)
  private parseGeoJSON(geojsonStr: string): Coordinate[] {
    try {
      return parseGeoJsonTrack(geojsonStr);
    } catch {
      return [];
    }
  }

  // Import route from a GPX string with metadata
  importRouteFromGPX(gpxXml: string, meta: { name: string; difficulty: 'easy' | 'moderate' | 'hard'; location?: string; tags?: string[]; imageUrl?: string }): WaterRoute | undefined {
    const coords = this.parseGPX(gpxXml);
    if (coords.length === 0) return undefined;
    
    const routeData: RouteFormData = {
      name: meta.name,
      description: meta.name,
      location: meta.location || 'Imported',
      difficulty: meta.difficulty,
      coordinates: coords,
      tags: meta.tags || [],
      imageUrl: meta.imageUrl,
    };
    return this.createRoute(routeData);
  }

  // Import route from a GeoJSON string
  importRouteFromGeoJSON(geojsonStr: string, meta: { name: string; difficulty: 'easy' | 'moderate' | 'hard'; location?: string; tags?: string[]; imageUrl?: string }): WaterRoute | undefined {
    const coords = this.parseGeoJSON(geojsonStr);
    if (coords.length < 2) return undefined;
    
    const routeData: RouteFormData = {
      name: meta.name,
      description: meta.name,
      location: meta.location || 'Imported',
      difficulty: meta.difficulty,
      coordinates: coords,
      tags: meta.tags || [],
      imageUrl: meta.imageUrl,
    };
    return this.createRoute(routeData);
  }

  private calculateRouteDistance(coordinates: Coordinate[]): number {
    // One geodesic for the whole app (issue #194 R-9) — see distanceBetweenMeters.
    return parseFloat((polylineLengthMeters(coordinates) / 1000).toFixed(1));
  }

  // ── KML import ──────────────────────────────────────────────────────────

  /**
   * Parse the text content of a KML <coordinates> element into Coordinate[].
   * Each tuple is "lng,lat[,alt]"; altitude is ignored.
   * Tuples that are not finite numbers or are out of valid lat/lng range are skipped.
   */
  private parseKMLCoordinates(text: string): Coordinate[] {
    return parseKMLCoordinateList(text);
  }

  /**
   * Parse a KML 2.2 file and return import candidates.
   * Each Placemark containing at least one LineString becomes one candidate.
   *
   * - Single candidate  → status 'success', route created immediately.
   * - Multiple candidates → status 'selectionRequired'; call finalizeKMLImport() after the
   *   user has chosen.
   * - Parse/validation failure → status 'error'.
   */
  importRouteFromKML(
    kmlString: string,
    meta: {
      name?: string;
      difficulty?: 'easy' | 'moderate' | 'hard';
      location?: string;
      tags?: string[];
    }
  ): KMLImportResult {
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(kmlString, 'application/xml');

      // DOMParser returns a parseerror element instead of throwing
      if (doc.getElementsByTagName('parsererror').length > 0) {
        return { status: 'error', error: 'Invalid XML: the file could not be parsed.' };
      }

      const root = doc.documentElement;
      if (!root || root.localName.toLowerCase() !== 'kml') {
        return { status: 'error', error: 'Not a KML file: the root element must be <kml>.' };
      }

      // Document-level fallback name/description (used when Placemark has none)
      const docEl = doc.getElementsByTagNameNS('*', 'Document')[0];
      const docName = docEl?.getElementsByTagNameNS('*', 'name')[0]?.textContent?.trim() ?? '';
      const docDesc = docEl?.getElementsByTagNameNS('*', 'description')[0]?.textContent?.trim() ?? '';

      const placemarkEls = Array.from(doc.getElementsByTagNameNS('*', 'Placemark'));
      if (placemarkEls.length === 0) {
        return { status: 'error', error: 'No <Placemark> elements found in the KML file.' };
      }

      const candidates: KMLImportCandidate[] = [];

      for (const placemark of placemarkEls) {
        const lineStrings = Array.from(placemark.getElementsByTagNameNS('*', 'LineString'));
        if (lineStrings.length === 0) continue;

        const name =
          placemark.getElementsByTagNameNS('*', 'name')[0]?.textContent?.trim() ||
          docName ||
          meta.name ||
          'KML Route';
        const description =
          placemark.getElementsByTagNameNS('*', 'description')[0]?.textContent?.trim() ||
          docDesc ||
          '';

        // Merge coordinates from all LineStrings within this single Placemark
        const coords: Coordinate[] = [];
        for (const ls of lineStrings) {
          const coordsText =
            ls.getElementsByTagNameNS('*', 'coordinates')[0]?.textContent ?? '';
          coords.push(...this.parseKMLCoordinates(coordsText));
        }

        if (coords.length >= 2) {
          candidates.push({ name, description, coordinates: coords });
        }
      }

      if (candidates.length === 0) {
        return {
          status: 'error',
          error:
            'No valid route found in the KML file. Each <LineString> must contain at least 2 coordinate points with valid lat/lng values.',
        };
      }

      if (candidates.length === 1) {
        const route = this.createRoute({
          name: meta.name || candidates[0].name,
          description: candidates[0].description,
          location: meta.location || 'Imported',
          difficulty: meta.difficulty || 'moderate',
          coordinates: candidates[0].coordinates,
          tags: meta.tags ?? ['imported', 'kml'],
          source: 'imported',
        });
        return { status: 'success', route };
      }

      return { status: 'selectionRequired', candidates };
    } catch (e) {
      return {
        status: 'error',
        error: 'Failed to parse KML file: ' + (e instanceof Error ? e.message : String(e)),
      };
    }
  }

  /**
   * Create a WaterRoute from a KML candidate selected by the user after a
   * selectionRequired result.
   */
  finalizeKMLImport(
    candidate: KMLImportCandidate,
    meta: {
      name?: string;
      difficulty?: 'easy' | 'moderate' | 'hard';
      location?: string;
      tags?: string[];
    }
  ): WaterRoute {
    return this.createRoute({
      name: meta.name || candidate.name,
      description: candidate.description,
      location: meta.location || 'Imported',
      difficulty: meta.difficulty || 'moderate',
      coordinates: candidate.coordinates,
      tags: meta.tags ?? ['imported', 'kml'],
      source: 'imported',
    });
  }

  /** Find a previously imported route by its originating rownative course id. */
  findRouteByRownativeId(courseId: string): WaterRoute | undefined {
    return this.routes.find((route) => route.source === 'rownative' && route.externalId === courseId);
  }

  importRouteFromRownative(data: RownativeRouteImportData): WaterRoute {
    // Distance is a property of the geometry, measured once, here (issue #194
    // R-5). rownative's distance_m is a straight-line gate chain by its own
    // schema, so it cannot describe a course that bends; it is display only.
    //
    // Kept to metre precision rather than R-5's two decimal places: AC-6 and
    // AC-7 require the stored distance to be within 1 m of both the polyline
    // and the engine's own total, and rounding to 10 m cannot do that. Cards
    // format it for display.
    const distanceKm = Math.round(polylineLengthMeters(data.coordinates)) / 1000;
    const difficulty = distanceKm < 4 ? 'easy' : distanceKm < 7 ? 'moderate' : 'hard';
    const normalizedStatus = data.status?.trim().toLowerCase();
    const sourceTag = normalizedStatus ? `status:${normalizedStatus}` : undefined;

    const isGateChain = data.geometrySource === 'gate-chain';
    const coordinates = resampleCoordinates(data.coordinates, IMPORT_RESAMPLE_MAX_GAP_M);

    return this.createRoute({
      name: data.name,
      description: `Imported from rownative.icu course ${data.id}.`,
      location: data.country,
      difficulty,
      coordinates,
      distanceKm,
      estimatedTimeMin: Math.round((distanceKm / 3.5) * 60),
      tags: [
        'rownative',
        'imported',
        sourceTag,
        `${GEOMETRY_SOURCE_TAG_PREFIX}${data.geometrySource}`,
        isGateChain ? OUTLINE_ONLY_TAG : undefined,
      ].filter((tag): tag is string => Boolean(tag)),
      source: 'rownative',
      externalId: data.id,
      geometrySource: data.geometrySource,
      externalDistanceMeters: data.externalDistanceMeters,
    });
  }

  updateRoute(id: string, data: Partial<RouteFormData>): WaterRoute | undefined {
    const route = this.routes.find((r) => r.id === id);
    if (!route) return undefined;

    if (data.name) route.name = data.name;
    if (data.description) route.description = data.description;
    if (data.location) route.location = data.location;
    if (data.difficulty) route.difficulty = data.difficulty;
    if (data.coordinates) {
      route.coordinates = data.coordinates;
      route.distance = this.calculateRouteDistance(data.coordinates);
    }
    if (data.tags) route.tags = data.tags;
    if (data.imageUrl) route.imageUrl = data.imageUrl;

    return route;
  }

  deleteRoute(id: string): boolean {
    const index = this.routes.findIndex((r) => r.id === id);
    if (index > -1) {
      this.routes.splice(index, 1);
      return true;
    }
    return false;
  }
}

export const routeService = new RouteService();
