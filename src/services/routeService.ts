import type { WaterRoute, Coordinate, RouteFormData } from '../types/index';

// Willowbrook River - a fictional 5km meandering river route
// Starts in forested highlands, passes through open meadows, winds through a small village, and ends at a tranquil lake delta
// At latitude 48°, 1 degree ≈ 111km; coordinates span ~0.045 degrees (5km) plus meanders add ~10% extra distance
const willowbrookRiverCoordinates: Coordinate[] = [
  // Section 1: Forest headwaters (0-1km) - gentle curves through dense woodland
  {"lat":48.1200,"lng":11.5800},{"lat":48.1202,"lng":11.5806},{"lat":48.1205,"lng":11.5811},{"lat":48.1209,"lng":11.5814},
  {"lat":48.1214,"lng":11.5815},{"lat":48.1219,"lng":11.5814},{"lat":48.1224,"lng":11.5811},{"lat":48.1228,"lng":11.5806},
  {"lat":48.1231,"lng":11.5800},{"lat":48.1233,"lng":11.5793},{"lat":48.1235,"lng":11.5786},{"lat":48.1237,"lng":11.5779},
  {"lat":48.1240,"lng":11.5773},{"lat":48.1244,"lng":11.5768},{"lat":48.1249,"lng":11.5765},{"lat":48.1255,"lng":11.5764},
  {"lat":48.1261,"lng":11.5765},{"lat":48.1266,"lng":11.5768},{"lat":48.1270,"lng":11.5773},{"lat":48.1273,"lng":11.5779},
  // Section 2: Open meadows (1-2km) - wider sweeping bends  
  {"lat":48.1276,"lng":11.5786},{"lat":48.1279,"lng":11.5793},{"lat":48.1283,"lng":11.5800},{"lat":48.1288,"lng":11.5806},
  {"lat":48.1294,"lng":11.5810},{"lat":48.1300,"lng":11.5812},{"lat":48.1307,"lng":11.5812},{"lat":48.1313,"lng":11.5810},
  {"lat":48.1319,"lng":11.5806},{"lat":48.1324,"lng":11.5800},{"lat":48.1328,"lng":11.5793},{"lat":48.1331,"lng":11.5785},
  {"lat":48.1334,"lng":11.5777},{"lat":48.1337,"lng":11.5769},{"lat":48.1341,"lng":11.5762},{"lat":48.1346,"lng":11.5756},
  {"lat":48.1352,"lng":11.5752},{"lat":48.1359,"lng":11.5750},{"lat":48.1366,"lng":11.5750},{"lat":48.1373,"lng":11.5752},
  // Section 3: Rocky narrows (2-3km) - tighter turns through a small gorge
  {"lat":48.1379,"lng":11.5756},{"lat":48.1384,"lng":11.5762},{"lat":48.1388,"lng":11.5769},{"lat":48.1391,"lng":11.5777},
  {"lat":48.1393,"lng":11.5785},{"lat":48.1394,"lng":11.5793},{"lat":48.1394,"lng":11.5801},{"lat":48.1393,"lng":11.5809},
  {"lat":48.1391,"lng":11.5817},{"lat":48.1390,"lng":11.5825},{"lat":48.1390,"lng":11.5833},{"lat":48.1392,"lng":11.5840},
  {"lat":48.1395,"lng":11.5846},{"lat":48.1400,"lng":11.5851},{"lat":48.1406,"lng":11.5854},{"lat":48.1413,"lng":11.5855},
  {"lat":48.1420,"lng":11.5854},{"lat":48.1426,"lng":11.5851},{"lat":48.1431,"lng":11.5846},{"lat":48.1435,"lng":11.5840},
  // Section 4: Village waterfront (3-4km) - gentle s-curves past riverside buildings
  {"lat":48.1439,"lng":11.5833},{"lat":48.1442,"lng":11.5825},{"lat":48.1446,"lng":11.5818},{"lat":48.1451,"lng":11.5812},
  {"lat":48.1457,"lng":11.5808},{"lat":48.1464,"lng":11.5806},{"lat":48.1471,"lng":11.5806},{"lat":48.1478,"lng":11.5808},
  {"lat":48.1484,"lng":11.5812},{"lat":48.1489,"lng":11.5818},{"lat":48.1493,"lng":11.5825},{"lat":48.1496,"lng":11.5833},
  {"lat":48.1499,"lng":11.5841},{"lat":48.1503,"lng":11.5848},{"lat":48.1508,"lng":11.5854},{"lat":48.1514,"lng":11.5858},
  {"lat":48.1521,"lng":11.5860},{"lat":48.1528,"lng":11.5860},{"lat":48.1535,"lng":11.5858},{"lat":48.1541,"lng":11.5854},
  // Section 5: Lake delta (4-5km) - widening into calm lake waters
  {"lat":48.1546,"lng":11.5848},{"lat":48.1550,"lng":11.5841},{"lat":48.1553,"lng":11.5833},{"lat":48.1556,"lng":11.5825},
  {"lat":48.1559,"lng":11.5817},{"lat":48.1563,"lng":11.5810},{"lat":48.1568,"lng":11.5804},{"lat":48.1574,"lng":11.5800},
  {"lat":48.1581,"lng":11.5798},{"lat":48.1588,"lng":11.5798},{"lat":48.1595,"lng":11.5800},{"lat":48.1601,"lng":11.5804},
  {"lat":48.1606,"lng":11.5810},{"lat":48.1610,"lng":11.5817},{"lat":48.1613,"lng":11.5825},{"lat":48.1616,"lng":11.5833},
  {"lat":48.1619,"lng":11.5842},{"lat":48.1623,"lng":11.5850},{"lat":48.1628,"lng":11.5857},{"lat":48.1634,"lng":11.5862},
];

// Data service for water routes
export class RouteService {
  private routes: WaterRoute[] = [];

  constructor() {
    this.initializeMockRoutes();
  }

  private initializeMockRoutes(): void {
    // Willowbrook River - the only route
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
    } catch {
      return [];
    }
  }

  private extractCoordsFromGeometry(geometry: { type?: string; coordinates?: number[][] | number[][][] }, coords: Coordinate[]) {
    if (!geometry || !geometry.type) return;
    if (geometry.type === 'LineString' && geometry.coordinates) {
      for (const c of geometry.coordinates) {
        coords.push({ lat: c[1], lng: c[0] });
      }
    } else if (geometry.type === 'MultiLineString' && geometry.coordinates) {
      for (const ln of geometry.coordinates) {
        for (const c of ln) coords.push({ lat: c[1], lng: c[0] });
      }
    } else if (geometry.type === 'Polygon' && geometry.coordinates) {
      // polygon: take first ring
      for (const c of (geometry.coordinates as number[][][])[0]) coords.push({ lat: c[1], lng: c[0] });
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
