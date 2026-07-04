import type { WaterRoute, Coordinate, RouteFormData } from '../types/index';
import {
  lakebledCoordinates,
  veniceGrandCanalCoordinates,
  henleyCoordinates,
  thamesTidewayCoordinates,
  charlesRiverCoordinates,
  willowbrookRiverCoordinates,
} from '../data/seedRouteCoordinates';
import { parseGeoJSONCoordinate, parseKMLCoordinateList } from '../utils/coordinateUtils';

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
  distanceMeters: number;
  coordinates: Coordinate[];
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
    // Initialize with all routes including fantasy routes based on real-world locations
    this.routes = [
      // Original fictional route
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
      
      // Fantasy Route 1: Lake Bled - Crystal Sanctum
      {
        id: '2',
        name: 'Crystal Sanctum of Bled',
        description: 'Circle the mystical alpine waters where ancient elven towers of pure crystal pierce the perpetual mist. The island sanctuary at the lake\'s heart pulses with ethereal light, its bell tower calling spirits from the depths. Bioluminescent creatures illuminate your path as you pass beneath the shadow of the floating citadel that replaced Bled Castle eons ago. The Julian Alps beyond shimmer with arcane barriers protecting this realm from the outside world.',
        distance: 6.0, // ~6km circumference based on real Lake Bled dimensions
        difficulty: 'easy',
        location: 'Lake Bled, Slovenia (Ethereal Realm)',
        coordinates: lakebledCoordinates,
        elevationGain: 5, // Flat lake circuit
        estimatedTime: Math.round((6.0 / 3.5) * 60), // ~103 minutes
        tags: ['lake', 'circular', 'fantasy', 'alpine', 'mystical', 'elven', 'crystal', 'beginner-friendly', 'scenic'],
        createdAt: new Date('2024-12-21'),
      },
      
      // Fantasy Route 2: Venice Grand Canal - Lost Souls
      {
        id: '3',
        name: 'Canale delle Anime Perdute',
        description: 'Navigate the haunted waterways where spectral gondoliers ferry souls between crumbling gothic palaces. The Canal of Lost Souls twists through a Venice that exists between worlds - phantom versions of Ca\' d\'Oro and Rialto Bridge flicker between their Renaissance glory and skeletal ruins. Beneath your hull, the sunken basilicas of drowned civilizations glow with trapped starlight. Approach the Punta della Dogana where the veil between worlds is thinnest.',
        distance: 3.8, // 3.8km based on real Grand Canal length
        difficulty: 'moderate',
        location: 'Venice, Italy (Shadowrealm)',
        coordinates: veniceGrandCanalCoordinates,
        elevationGain: 0, // Sea level canal
        estimatedTime: Math.round((3.8 / 3.0) * 60), // ~76 minutes at slower pace due to navigation
        tags: ['canal', 'gothic', 'fantasy', 'urban', 'haunted', 'spectral', 'historic', 'winding', 'challenging-navigation'],
        createdAt: new Date('2024-12-21'),
      },
      
      // Fantasy Route 3: Henley - Steampunk Gauntlet  
      {
        id: '4',
        name: 'The Iron Sovereign\'s Gauntlet',
        description: 'Race the straight 2.1km course where brass automatons judge your every stroke with clockwork precision. Temple Island\'s starting pavilion has been replaced by a massive steam-powered timing mechanism, its gears visible through glass walls. Pneumatic tubes run alongside the course, transmitting your split times to the calculating engines at Phyllis Court. Victorian spectators in mechanical exoskeletons line the banks, their opera glasses enhanced with analytical displays.',
        distance: 2.1, // 2,112m based on real Henley Royal Regatta course
        difficulty: 'hard',
        location: 'Henley-on-Thames, England (Steamworks Era)',
        coordinates: henleyCoordinates,
        elevationGain: 0, // Flat river course
        estimatedTime: Math.round((2.1 / 4.5) * 60), // ~28 minutes at race pace (it's a race course!)
        tags: ['river', 'straight', 'racing', 'steampunk', 'victorian', 'competitive', 'historic', 'timed', 'sprint'],
        createdAt: new Date('2024-12-21'),
      },
      
      // Fantasy Route 4: Thames Tideway - Leviathan's Wake
      {
        id: '5',
        name: 'The Leviathan\'s Wake',
        description: 'Follow the Championship Course through a neo-noir London where colossal sea creatures slumber beneath the murky waters. From Mortlake\'s fog-shrouded start, pass the bioluminescent tentacles that wrap around Hammersmith Bridge\'s twisted iron. Holographic advertisements flicker from the brutalist towers that replaced the Victorian warehouses. Something massive disturbs the water near Barnes - the Leviathan stirs. Reach Putney before it fully wakes.',
        distance: 6.8, // 6.8km (4.25 miles) based on real Championship Course
        difficulty: 'hard',
        location: 'River Thames, London (Dystopian Future)',
        coordinates: thamesTidewayCoordinates,
        elevationGain: 0, // Tidal river
        estimatedTime: Math.round((6.8 / 4.0) * 60), // ~102 minutes at brisk pace
        tags: ['river', 'tidal', 'urban', 'dystopian', 'kaiju', 'noir', 'competitive', 'long-distance', 'challenging'],
        createdAt: new Date('2024-12-21'),
      },
      
      // Fantasy Route 5: Charles River - Infinite Equation
      {
        id: '6',
        name: 'The Architect\'s Infinite Equation',
        description: 'Row through the impossible architecture where Harvard and MIT\'s greatest minds bent reality itself. The Head of the Charles course now passes through tesseract towers and Penrose staircases. Each bridge you pass under exists in multiple dimensions simultaneously - Weeks Footbridge folds through seven planes of existence. The boathouses are research stations into the nature of spacetime, their experiments causing the river to occasionally flow upstream. Calculate your course through the Infinite Equation.',
        distance: 4.8, // 4.8km (3 miles) based on real Head of the Charles course
        difficulty: 'moderate',
        location: 'Charles River, Boston (Quantum Cambridge)',
        coordinates: charlesRiverCoordinates,
        elevationGain: 0, // River basin
        estimatedTime: Math.round((4.8 / 3.5) * 60), // ~82 minutes
        tags: ['river', 'academic', 'fantasy', 'sci-fi', 'geometric', 'university', 'bridges', 'technical', 'mind-bending'],
        createdAt: new Date('2024-12-21'),
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
    };

    this.routes.push(newRoute);
    return newRoute;
  }

  // Parse GPX XML into coordinates (trkpt or rtept)
  private parseGPX(gpxXml: string): Coordinate[] {
    const parser = new DOMParser();
    const doc = parser.parseFromString(gpxXml, 'application/xml');
    const points: Coordinate[] = [];
    const trkpts = doc.getElementsByTagName('trkpt');
    if (trkpts.length > 0) {
      for (let i = 0; i < trkpts.length; i++) {
        const node = trkpts[i];
        const lat = parseFloat(node.getAttribute('lat') || '0');
        const lng = parseFloat(node.getAttribute('lon') || '0');
        if (!isNaN(lat) && !isNaN(lng)) points.push({ lat, lng });
      }
      return points;
    }
    const rtepts = doc.getElementsByTagName('rtept');
    for (let i = 0; i < rtepts.length; i++) {
      const node = rtepts[i];
      const lat = parseFloat(node.getAttribute('lat') || '0');
      const lng = parseFloat(node.getAttribute('lon') || '0');
      if (!isNaN(lat) && !isNaN(lng)) points.push({ lat, lng });
    }
    return points;
  }

  // Parse GeoJSON string into coordinates (LineString / MultiLineString)
  private parseGeoJSON(geojsonStr: string): Coordinate[] {
    try {
      const obj = JSON.parse(geojsonStr);
      const coords: Coordinate[] = [];
      if (obj.type === 'FeatureCollection' && Array.isArray(obj.features)) {
        for (const f of obj.features) {
          if (!f.geometry) continue;
          this.extractCoordsFromGeometry(f.geometry, coords);
        }
      } else if (obj.type === 'Feature' && obj.geometry) {
        this.extractCoordsFromGeometry(obj.geometry, coords);
      } else if (obj.type) {
        this.extractCoordsFromGeometry(obj, coords);
      }
      return coords;
    } catch {
      return [];
    }
  }

  private extractCoordsFromGeometry(geometry: { type?: string; coordinates?: number[][] | number[][][] }, coords: Coordinate[]) {
    if (!geometry || !geometry.type) return;
    if (geometry.type === 'LineString' && geometry.coordinates) {
      for (const c of geometry.coordinates as number[][]) {
        const parsed = parseGeoJSONCoordinate(c);
        if (parsed) coords.push(parsed);
      }
    } else if (geometry.type === 'MultiLineString' && geometry.coordinates) {
      for (const ln of geometry.coordinates as number[][][]) {
        for (const c of ln) {
          const parsed = parseGeoJSONCoordinate(c);
          if (parsed) coords.push(parsed);
        }
      }
    } else if (geometry.type === 'Polygon' && geometry.coordinates) {
      const firstRing = (geometry.coordinates as number[][][])[0];
      if (!Array.isArray(firstRing)) return;
      // polygon: take first ring
      for (const c of firstRing) {
        const parsed = parseGeoJSONCoordinate(c);
        if (parsed) coords.push(parsed);
      }
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
    // Haversine formula for distance calculation
    let totalDistance = 0;
    for (let i = 0; i < coordinates.length - 1; i++) {
      totalDistance += this.getDistanceBetweenPoints(
        coordinates[i],
        coordinates[i + 1]
      );
    }
    return parseFloat(totalDistance.toFixed(1));
  }

  private getDistanceBetweenPoints(coord1: Coordinate, coord2: Coordinate): number {
    const R = 6371; // Earth's radius in km
    const dLat = ((coord2.lat - coord1.lat) * Math.PI) / 180;
    const dLng = ((coord2.lng - coord1.lng) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((coord1.lat * Math.PI) / 180) *
        Math.cos((coord2.lat * Math.PI) / 180) *
        Math.sin(dLng / 2) *
        Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
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

  importRouteFromRownative(data: RownativeRouteImportData): WaterRoute {
    const distanceKm = Math.round(data.distanceMeters / 10) / 100;
    const difficulty = distanceKm < 4 ? 'easy' : distanceKm < 7 ? 'moderate' : 'hard';
    const normalizedStatus = data.status?.trim().toLowerCase();
    const sourceTag = normalizedStatus ? `status:${normalizedStatus}` : undefined;

    return this.createRoute({
      name: data.name,
      description: `Imported from rownative.icu course ${data.id}.`,
      location: data.country,
      difficulty,
      coordinates: data.coordinates,
      distanceKm,
      estimatedTimeMin: Math.round((distanceKm / 3.5) * 60),
      tags: ['rownative', 'imported', sourceTag].filter((tag): tag is string => Boolean(tag)),
      source: 'rownative',
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
