import type { WaterRoute, Coordinate, RouteFormData } from '../types/index';

// Mock data service for water routes
export class RouteService {
  private routes: WaterRoute[] = [];
  private waterBodies: { id: string; name: string; bbox: { minLat: number; maxLat: number; minLng: number; maxLng: number } }[] = [];

  constructor() {
    this.initializeWaterBodies();
    this.initializeMockRoutes();
    this.ensureRoutesAreInWater();
  }

  private ensureRoutesAreInWater() {
    this.routes = this.routes.map((route) => {
      if (this.isCoordinatesMostlyWater(route.coordinates)) return route;
      // try to repair based on route name
      const mapping: Record<string, () => Coordinate[]> = {
        'Lake Tahoe Circuit': () => this.generateCircularRoute({ lat: 39.0968, lng: -120.0324 }, 28.5, 48, this.waterBodies.find(b=>b.id === 'lake-tahoe')?.bbox),
        'Central Park Loop': () => this.generateCircularRoute({ lat: 40.7885, lng: -73.9557 }, 2.4, 28, this.waterBodies.find(b=>b.id === 'central-park-reservoir')?.bbox),
        'Thames River Challenge': () => this.generateMeanderingRoute({ lat: 51.5074, lng: -0.1278 }, { lat: 51.4829, lng: -0.0585 }, 12.8, 60, this.waterBodies.find(b=>b.id === 'thames')?.bbox),
        'Crater Lake Explorer': () => this.generateCircularRoute({ lat: 42.9449, lng: -122.1107 }, 7.7, 36, this.waterBodies.find(b=>b.id === 'crater-lake')?.bbox),
        'Finger Lakes Sprint': () => this.generateMeanderingRoute({ lat: 42.7486, lng: -76.8358 }, { lat: 42.7798, lng: -76.8291 }, 8.2, 28, this.waterBodies.find(b=>b.id === 'seneca-lake')?.bbox),
        'Boston Harbor Classic': () => this.generateMeanderingRoute({ lat: 42.3601, lng: -71.0589 }, { lat: 42.3489, lng: -71.0589 }, 6.4, 24, this.waterBodies.find(b=>b.id === 'boston-harbor')?.bbox),
        'Henley Regatta Route': () => this.generateLinearRoute({ lat: 51.5361, lng: -0.7661 }, { lat: 51.5461, lng: -0.7603 }, 12, this.waterBodies.find(b=>b.id === 'henley')?.bbox),
        'Venice Grand Canal': () => this.generateMeanderingRoute({ lat: 45.4356, lng: 12.3365 }, { lat: 45.4415, lng: 12.3380 }, 3.8, 28, this.waterBodies.find(b=>b.id === 'venice')?.bbox),
      };
      const create = mapping[route.name];
      if (create) {
        const coords = create();
        return { ...route, coordinates: coords } as WaterRoute;
      }
  // fallback: clamp coords to nearest water bbox
  const clamped = route.coordinates.map(c => this.clampToNearestWaterBBox(c));
      return { ...route, coordinates: clamped } as WaterRoute;
    });
  }

  private initializeWaterBodies(): void {
    // Approximate bounding boxes for each water body mentioned.
    this.waterBodies = [
      {
        id: 'lake-tahoe',
        name: 'Lake Tahoe',
        bbox: { minLat: 38.90, maxLat: 39.25, minLng: -120.16, maxLng: -119.80 },
      },
      {
        id: 'central-park-reservoir',
        name: 'Central Park Reservoir',
        bbox: { minLat: 40.7816, maxLat: 40.7944, minLng: -73.9659, maxLng: -73.9486 },
      },
      {
        id: 'thames',
        name: 'River Thames (Central)',
        bbox: { minLat: 51.48, maxLat: 51.51, minLng: -0.14, maxLng: -0.06 },
      },
      {
        id: 'crater-lake',
        name: 'Crater Lake',
        bbox: { minLat: 42.93, maxLat: 42.96, minLng: -122.14, maxLng: -122.07 },
      },
      {
        id: 'seneca-lake',
        name: 'Seneca Lake',
        bbox: { minLat: 42.73, maxLat: 42.79, minLng: -76.86, maxLng: -76.80 },
      },
      {
        id: 'boston-harbor',
        name: 'Boston Harbor',
        bbox: { minLat: 42.33, maxLat: 42.38, minLng: -71.08, maxLng: -70.99 },
      },
      {
        id: 'henley',
        name: 'Henley-on-Thames',
        bbox: { minLat: 51.53, maxLat: 51.55, minLng: -0.77, maxLng: -0.75 },
      },
      {
        id: 'venice',
        name: 'Venice Grand Canal',
        bbox: { minLat: 45.43, maxLat: 45.45, minLng: 12.33, maxLng: 12.35 },
      },
    ];
  }

  private findContainingWaterBodies(coord: Coordinate) {
    return this.waterBodies.filter((b) => {
      const { minLat, maxLat, minLng, maxLng } = b.bbox;
      return coord.lat >= minLat && coord.lat <= maxLat && coord.lng >= minLng && coord.lng <= maxLng;
    });
  }

  // Check if the majority of coords fall inside any defined water body bounding box
  private isCoordinatesMostlyWater(coords: Coordinate[]) {
    if (!coords || coords.length === 0) return false;
    const countInWater = coords.reduce((count, c) => {
      const found = this.findContainingWaterBodies(c);
      return found.length > 0 ? count + 1 : count;
    }, 0);
    return countInWater >= Math.ceil(coords.length * 0.6); // 60% threshold
  }

  // Clamp a coordinate to its containing water body's bounding box (if any)
  private clampToWaterBBox(coord: Coordinate): Coordinate {
    const bodies = this.findContainingWaterBodies(coord);
    if (!bodies || bodies.length === 0) return coord;
    const b = bodies[0].bbox;
    return {
      lat: Math.min(Math.max(coord.lat, b.minLat), b.maxLat),
      lng: Math.min(Math.max(coord.lng, b.minLng), b.maxLng),
    };
  }

  private clampToBBox(coord: Coordinate, bbox: { minLat: number; maxLat: number; minLng: number; maxLng: number } | undefined): Coordinate {
    if (!bbox) return coord;
    return {
      lat: Math.min(Math.max(coord.lat, bbox.minLat), bbox.maxLat),
      lng: Math.min(Math.max(coord.lng, bbox.minLng), bbox.maxLng),
    };
  }

  private getBBoxCenter(bbox: { minLat: number; maxLat: number; minLng: number; maxLng: number }): Coordinate {
    return { lat: (bbox.minLat + bbox.maxLat) / 2, lng: (bbox.minLng + bbox.maxLng) / 2 };
  }

  private findNearestWaterBBox(coord: Coordinate) {
    let nearest: { id: string; name: string; bbox: any } | undefined;
    let bestDist = Number.POSITIVE_INFINITY;
    for (const b of this.waterBodies) {
      const center = this.getBBoxCenter(b.bbox);
      const d = this.getDistanceBetweenPoints(coord, center);
      if (d < bestDist) {
        bestDist = d;
        nearest = b;
      }
    }
    return nearest;
  }

  private clampToNearestWaterBBox(coord: Coordinate) {
    const nearest = this.findNearestWaterBBox(coord);
    if (!nearest) return coord;
    return this.clampToBBox(coord, nearest.bbox);
  }

  private initializeMockRoutes(): void {
    // Pre-generate coordinates for routes and compute distances from them
  const lakeTahoeBBox = this.waterBodies.find((b) => b.id === 'lake-tahoe')?.bbox;
  const lakeTahoeCoords = this.generateCircularRoute({ lat: 39.0968, lng: -120.0324 }, 28.5, 48, lakeTahoeBBox);

  const centralParkBBox = this.waterBodies.find((b) => b.id === 'central-park-reservoir')?.bbox;
  const centralParkCoords = this.generateCircularRoute({ lat: 40.7885, lng: -73.9557 }, 2.4, 28, centralParkBBox);

  const thamesBBox = this.waterBodies.find((b) => b.id === 'thames')?.bbox;
  const thamesCoords = this.generateMeanderingRoute({ lat: 51.5074, lng: -0.1278 }, { lat: 51.4829, lng: -0.0585 }, 12.8, 60, thamesBBox);

  const craterBBox = this.waterBodies.find((b) => b.id === 'crater-lake')?.bbox;
  const craterCoords = this.generateCircularRoute({ lat: 42.9449, lng: -122.1107 }, 7.7, 36, craterBBox);

  const senecaBBox = this.waterBodies.find((b) => b.id === 'seneca-lake')?.bbox;
  const fingerCoords = this.generateMeanderingRoute({ lat: 42.7486, lng: -76.8358 }, { lat: 42.7798, lng: -76.8291 }, 8.2, 28, senecaBBox);

  const bostonBBox = this.waterBodies.find((b) => b.id === 'boston-harbor')?.bbox;
  const bostonCoords = this.generateMeanderingRoute({ lat: 42.3601, lng: -71.0589 }, { lat: 42.3489, lng: -71.0589 }, 6.4, 24, bostonBBox);

  const henleyBBox = this.waterBodies.find((b) => b.id === 'henley')?.bbox;
  const henleyCoords = this.generateLinearRoute({ lat: 51.5361, lng: -0.7661 }, { lat: 51.5461, lng: -0.7603 }, 12, henleyBBox);

  const veniceBBox = this.waterBodies.find((b) => b.id === 'venice')?.bbox;
  const veniceCoords = this.generateMeanderingRoute({ lat: 45.4356, lng: 12.3365 }, { lat: 45.4415, lng: 12.3380 }, 3.8, 28, veniceBBox);

    this.routes = [
      {
        id: '1',
        name: 'Lake Tahoe Circuit',
        description: 'Beautiful full circuit around Lake Tahoe with stunning alpine views',
  distance: 28.5,
        difficulty: 'hard',
        location: 'Lake Tahoe, CA',
        coordinates: lakeTahoeCoords,
  elevationGain: 420,
  estimatedTime: Math.round((28.5 / 3.5) * 60),
        tags: ['scenic', 'alpine', 'long-distance', 'moderate-current'],
        createdAt: new Date('2024-01-15'),
      },
      {
        id: '2',
        name: 'Central Park Loop',
        description: 'Iconic loop through New York City\'s Central Park Reservoir',
  distance: 2.4,
        difficulty: 'easy',
        location: 'Central Park, NYC',
  coordinates: centralParkCoords,
  elevationGain: 0,
  estimatedTime: Math.round((2.4 / 3.5) * 60),
        tags: ['urban', 'scenic', 'beginner-friendly', 'no-current'],
        createdAt: new Date('2024-02-01'),
      },
      {
        id: '3',
        name: 'Thames River Challenge',
        description: 'River rowing challenge with tide considerations and heritage landmarks',
  distance: 12.8,
        difficulty: 'moderate',
        location: 'London, UK',
  coordinates: thamesCoords,
  elevationGain: 0,
  estimatedTime: Math.round((12.8 / 3.5) * 60),
        tags: ['river', 'historic', 'tidal', 'urban'],
        createdAt: new Date('2024-03-10'),
      },
      {
        id: '4',
        name: 'Crater Lake Explorer',
        description: 'Deep, pristine volcanic crater lake with surrounding mountains',
  distance: 7.7,
        difficulty: 'moderate',
        location: 'Crater Lake, OR',
  coordinates: craterCoords,
  elevationGain: 200,
  estimatedTime: Math.round((7.7 / 3.5) * 60),
        tags: ['volcanic', 'scenic', 'high-altitude', 'mountain-views'],
        createdAt: new Date('2024-04-05'),
      },
      {
        id: '5',
        name: 'Finger Lakes Sprint',
        description: 'Fast-paced training route on scenic Seneca Lake',
  distance: 8.2,
        difficulty: 'hard',
        location: 'Seneca Lake, NY',
  coordinates: fingerCoords,
  elevationGain: 0,
  estimatedTime: Math.round((8.2 / 3.5) * 60),
        tags: ['flat', 'fast', 'training', 'no-current'],
        createdAt: new Date('2024-05-12'),
      },
      {
        id: '6',
        name: 'Boston Harbor Classic',
        description: 'Historic harbor rowing with views of the Boston skyline and islands',
  distance: 6.4,
        difficulty: 'moderate',
        location: 'Boston Harbor, MA',
  coordinates: bostonCoords,
  elevationGain: 0,
  estimatedTime: Math.round((6.4 / 3.5) * 60),
        tags: ['harbor', 'historic', 'tidal', 'urban-views'],
        createdAt: new Date('2024-06-20'),
      },
      {
        id: '7',
        name: 'Henley Regatta Route',
        description: 'Famous Oxford-Cambridge rowing race course with traditional charm',
  distance: 2.1,
        difficulty: 'easy',
        location: 'River Thames, Henley-on-Thames, UK',
  coordinates: henleyCoords,
  elevationGain: 0,
  estimatedTime: Math.round((2.1 / 3.5) * 60),
        tags: ['racing', 'historic', 'tidal', 'beginner-friendly'],
        createdAt: new Date('2024-07-08'),
      },
      {
        id: '8',
        name: 'Venice Grand Canal',
        description: 'Iconic Venetian waterway with historic palaces and gondola culture',
  distance: 3.8,
        difficulty: 'moderate',
        location: 'Venice, Italy',
  coordinates: veniceCoords,
  elevationGain: 0,
  estimatedTime: Math.round((3.8 / 3.5) * 60),
        tags: ['canal', 'historic', 'scenic', 'italy', 'cultural'],
        createdAt: new Date('2024-08-15'),
      },
    ];
  }

  // Create a circular route around a center point approximating the specified circumference (km)
  private generateCircularRoute(center: Coordinate, circumferenceKm: number, points = 36, bbox?: { minLat: number; maxLat: number; minLng: number; maxLng: number }): Coordinate[] {
    const radiusKm = circumferenceKm / (2 * Math.PI);
    const coords: Coordinate[] = [];
  const latKmDeg = 111.32; // km per degree latitude
    const lngKmDeg = (deg: number) => 111.32 * Math.cos((deg * Math.PI) / 180);

    for (let i = 0; i < points; i++) {
      const theta = (2 * Math.PI * i) / points;
      const dLat = (radiusKm * Math.cos(theta)) / latKmDeg;
      const dLng = (radiusKm * Math.sin(theta)) / lngKmDeg(center.lat);
      coords.push({ lat: center.lat + dLat, lng: center.lng + dLng });
    }

    // Ensure the route length closely matches the target circumference by calculating and adjusting
    const calc = this.calculateRouteDistance(coords);
  if (Math.abs(calc - circumferenceKm) > 0.5) {
      // If there's a notable difference, scale the radius
      const scale = circumferenceKm / (calc || 1);
      const newRadiusKm = radiusKm * scale;
      const scaledCoords: Coordinate[] = [];
      for (let i = 0; i < points; i++) {
        const theta = (2 * Math.PI * i) / points;
        const dLat = (newRadiusKm * Math.cos(theta)) / latKmDeg;
        const dLng = (newRadiusKm * Math.sin(theta)) / lngKmDeg(center.lat);
        scaledCoords.push({ lat: center.lat + dLat, lng: center.lng + dLng });
      }
  return bbox ? scaledCoords.map((c) => this.clampToBBox(c, bbox)) : scaledCoords;
    }
  return bbox ? coords.map((c) => this.clampToBBox(c, bbox)) : coords;
  }

  // Create linear interpolation between start and end with 'points' number of vertices
  private generateLinearRoute(start: Coordinate, end: Coordinate, points = 10, bbox?: { minLat: number; maxLat: number; minLng: number; maxLng: number }): Coordinate[] {
    const coords: Coordinate[] = [];
    for (let i = 0; i < points; i++) {
      const t = i / (points - 1);
      const lat = start.lat + (end.lat - start.lat) * t;
      const lng = start.lng + (end.lng - start.lng) * t;
      coords.push({ lat, lng });
    }
  return bbox ? coords.map((c) => this.clampToBBox(c, bbox)) : coords;
  }

  // Generate a meandering route between two coordinates that approximates `targetDistanceKm`
  private generateMeanderingRoute(start: Coordinate, end: Coordinate, targetDistanceKm: number, points = 32, bbox?: { minLat: number; maxLat: number; minLng: number; maxLng: number }): Coordinate[] {
    // Start with linear points
    let coords = this.generateLinearRoute(start, end, points);
    let currentDistance = this.calculateRouteDistance(coords);
    if (currentDistance >= targetDistanceKm) return coords;

    // We'll add sine-wave lateral offsets to increase distance until we meet the target distance
    const maxIter = 18;
    let amplitudeKm = Math.max(0.02, (targetDistanceKm - currentDistance) / 6);
    const cycles = 3; // number of sinuosity cycles to insert

    for (let iter = 0; iter < maxIter; iter++) {
      // Build sine offset coordinates
      const newCoords: Coordinate[] = [];
      for (let i = 0; i < points; i++) {
        const t = i / (points - 1);
        const lat = start.lat + (end.lat - start.lat) * t;
        const lng = start.lng + (end.lng - start.lng) * t;
        // Direction vector
        const dx = end.lng - start.lng;
        const dy = end.lat - start.lat;
        // Perpendicular normalized
        const length = Math.sqrt(dx * dx + dy * dy) || 1e-6;
        const px = -dy / length;
        const py = dx / length;
        // Sine offset amplitude at this t
        const offsetFactor = Math.sin(2 * Math.PI * cycles * t);
        // Convert amplitude from km to degrees
        const dLatDeg = (amplitudeKm * offsetFactor) / 111.32;
        const dLngDeg = (amplitudeKm * offsetFactor) / (111.32 * Math.cos((lat * Math.PI) / 180));
        // Apply offset perpendicular to path
        newCoords.push({ lat: lat + py * dLatDeg, lng: lng + px * dLngDeg });
      }
      const newDistance = this.calculateRouteDistance(newCoords);
      if (Math.abs(newDistance - targetDistanceKm) < 0.2) {
        // Accept within 200m tolerance
  return bbox ? newCoords.map((c) => this.clampToBBox(c, bbox)) : newCoords;
      }
      // Adjust amplitude - if too short, increase amplitude, else reduce
      if (newDistance < targetDistanceKm) {
        amplitudeKm *= 1.6;
      } else {
        amplitudeKm *= 0.7;
      }
      // Limit amplitude to avoid unrealistic offsets
      amplitudeKm = Math.min(amplitudeKm, Math.max(0.05, targetDistanceKm / 5));
      coords = newCoords;
      currentDistance = newDistance;
    }

    // If no convergence, return the last attempt with linear+small offset
    return bbox ? coords.map((c) => this.clampToWaterBBox(c)) : coords;
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
    const newRoute: WaterRoute = {
      id: Date.now().toString(),
      name: data.name,
      description: data.description,
      distance: this.calculateRouteDistance(data.coordinates),
      difficulty: data.difficulty,
      location: data.location,
      coordinates: data.coordinates,
      elevationGain: 0, // Would be calculated from elevation data
      estimatedTime: Math.round(
        (this.calculateRouteDistance(data.coordinates) / 3.5) * 60
      ), // Rough estimate
      imageUrl: data.imageUrl,
      tags: data.tags,
      createdAt: new Date(),
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
    } catch (e) {
      return [];
    }
  }

  private extractCoordsFromGeometry(geometry: any, coords: Coordinate[]) {
    if (!geometry || !geometry.type) return;
    if (geometry.type === 'LineString') {
      for (const c of geometry.coordinates) {
        coords.push({ lat: c[1], lng: c[0] });
      }
    } else if (geometry.type === 'MultiLineString') {
      for (const ln of geometry.coordinates) {
        for (const c of ln) coords.push({ lat: c[1], lng: c[0] });
      }
    } else if (geometry.type === 'Polygon') {
      // polygon: take first ring
      for (const c of geometry.coordinates[0]) coords.push({ lat: c[1], lng: c[0] });
    }
  }

  // Import route from a GPX string with metadata
  importRouteFromGPX(gpxXml: string, meta: { name: string; difficulty: 'easy' | 'moderate' | 'hard'; location?: string; tags?: string[]; imageUrl?: string }, force = false): WaterRoute | undefined {
    const coords = this.parseGPX(gpxXml);
    if (coords.length === 0) return undefined;
    const isWater = this.isCoordinatesMostlyWater(coords);
    if (!isWater && !force) {
      // don't allow import unless force flag is provided
      return undefined;
    }
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
  importRouteFromGeoJSON(geojsonStr: string, meta: { name: string; difficulty: 'easy' | 'moderate' | 'hard'; location?: string; tags?: string[]; imageUrl?: string }, force = false): WaterRoute | undefined {
    const coords = this.parseGeoJSON(geojsonStr);
    if (coords.length === 0) return undefined;
    const isWater = this.isCoordinatesMostlyWater(coords);
    if (!isWater && !force) {
      return undefined;
    }
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
