import { describe, it, expect } from 'vitest';
import { routeService } from '../services/routeService';

// Willowbrook River bounding box
const WILLOWBROOK_BBOX = { minLat: 48.1200, maxLat: 48.1634, minLng: 11.5750, maxLng: 11.5862 };

// Fantasy routes bounding boxes based on real-world locations
const LAKE_BLED_BBOX = { minLat: 46.3540, maxLat: 46.3740, minLng: 14.0770, maxLng: 14.1060 };
const VENICE_BBOX = { minLat: 45.4280, maxLat: 45.4420, minLng: 12.3200, maxLng: 12.3600 };
const HENLEY_BBOX = { minLat: 51.5420, maxLat: 51.5610, minLng: -0.9120, maxLng: -0.8750 };
const THAMES_BBOX = { minLat: 51.4670, maxLat: 51.4870, minLng: -0.2700, maxLng: -0.1520 };
const CHARLES_BBOX = { minLat: 42.3520, maxLat: 42.3770, minLng: -71.1560, maxLng: -71.1090 };

describe('RouteService basic data', () => {
  it('provides all 6 routes (1 original + 5 fantasy routes)', () => {
    const routes = routeService.getAllRoutes();
    expect(routes.length).toBe(6);
    
    // Check all route IDs exist
    const ids = routes.map(r => r.id);
    expect(ids).toContain('1'); // Willowbrook
    expect(ids).toContain('2'); // Lake Bled
    expect(ids).toContain('3'); // Venice
    expect(ids).toContain('4'); // Henley
    expect(ids).toContain('5'); // Thames
    expect(ids).toContain('6'); // Charles River
  });
  
  it('provides Willowbrook River route with distance and coordinates', () => {
    const routes = routeService.getAllRoutes();
    
    // Willowbrook River route (only route)
    const willowbrook = routes.find(r => r.id === '1');
    expect(willowbrook?.name).toBe('Willowbrook River');
    expect(willowbrook?.distance).toBeCloseTo(5.0, 1);
    expect(willowbrook?.coordinates.length).toBeGreaterThan(70); // At least 70 coordinate points across 5 sections
    expect(willowbrook?.difficulty).toBe('easy');
    expect(willowbrook?.location).toBe('Willowbrook Valley');
  });

  it('ensures Willowbrook River coordinates lie within bounding box', () => {
    const routes = routeService.getAllRoutes();
    const willowbrook = routes.find(r => r.id === '1')!;
    
    // Check that all coordinates are within Willowbrook bbox
    const outOfBounds = willowbrook.coordinates.filter(c => 
      c.lat < WILLOWBROOK_BBOX.minLat - 0.01 || c.lat > WILLOWBROOK_BBOX.maxLat + 0.01 ||
      c.lng < WILLOWBROOK_BBOX.minLng - 0.01 || c.lng > WILLOWBROOK_BBOX.maxLng + 0.01
    );
    
    // All points should be within bounds
    expect(outOfBounds.length).toBe(0);
  });

  it('Willowbrook route covers approximately 5km with proper meanders', () => {
    const routes = routeService.getAllRoutes();
    const willowbrook = routes.find(r => r.id === '1')!;
    
    // The route should have 5 distinct sections with points totaling at least 70
    expect(willowbrook.coordinates.length).toBeGreaterThan(70);
    
    // Route should cover terrain from forest headwaters to lake delta
    expect(willowbrook.tags).toContain('forest');
    expect(willowbrook.tags).toContain('meadow');
    expect(willowbrook.tags).toContain('village');
    expect(willowbrook.tags).toContain('lake');
  });
});

describe('Fantasy Routes based on real-world locations', () => {
  it('Crystal Sanctum of Bled (Lake Bled) is circular with correct geography', () => {
    const routes = routeService.getAllRoutes();
    const bled = routes.find(r => r.id === '2')!;
    
    expect(bled.name).toBe('Crystal Sanctum of Bled');
    expect(bled.distance).toBeCloseTo(6.0, 1); // ~6km circumference
    expect(bled.difficulty).toBe('easy');
    expect(bled.tags).toContain('circular');
    expect(bled.tags).toContain('lake');
    expect(bled.tags).toContain('fantasy');
    
    // Check circular: start and end should be the same point
    const coords = bled.coordinates;
    expect(coords[0].lat).toBeCloseTo(coords[coords.length - 1].lat, 3);
    expect(coords[0].lng).toBeCloseTo(coords[coords.length - 1].lng, 3);
    
    // Check coordinates are within Lake Bled area (Slovenia)
    const outOfBounds = coords.filter(c =>
      c.lat < LAKE_BLED_BBOX.minLat || c.lat > LAKE_BLED_BBOX.maxLat ||
      c.lng < LAKE_BLED_BBOX.minLng || c.lng > LAKE_BLED_BBOX.maxLng
    );
    expect(outOfBounds.length).toBe(0);
  });
  
  it('Canale delle Anime Perdute (Venice) has correct S-curve canal geography', () => {
    const routes = routeService.getAllRoutes();
    const venice = routes.find(r => r.id === '3')!;
    
    expect(venice.name).toBe('Canale delle Anime Perdute');
    expect(venice.distance).toBeCloseTo(3.8, 1); // 3.8km like real Grand Canal
    expect(venice.difficulty).toBe('moderate');
    expect(venice.tags).toContain('canal');
    expect(venice.tags).toContain('gothic');
    expect(venice.tags).toContain('winding');
    
    // Check coordinates are within Venice area
    const coords = venice.coordinates;
    const outOfBounds = coords.filter(c =>
      c.lat < VENICE_BBOX.minLat || c.lat > VENICE_BBOX.maxLat ||
      c.lng < VENICE_BBOX.minLng || c.lng > VENICE_BBOX.maxLng
    );
    expect(outOfBounds.length).toBe(0);
  });
  
  it('The Iron Sovereign\'s Gauntlet (Henley) is a straight 2.1km race course', () => {
    const routes = routeService.getAllRoutes();
    const henley = routes.find(r => r.id === '4')!;
    
    expect(henley.name).toBe('The Iron Sovereign\'s Gauntlet');
    expect(henley.distance).toBeCloseTo(2.1, 1); // 2,112m Henley course
    expect(henley.difficulty).toBe('hard');
    expect(henley.tags).toContain('straight');
    expect(henley.tags).toContain('racing');
    expect(henley.tags).toContain('steampunk');
    
    // Check coordinates are within Henley area
    const coords = henley.coordinates;
    const outOfBounds = coords.filter(c =>
      c.lat < HENLEY_BBOX.minLat || c.lat > HENLEY_BBOX.maxLat ||
      c.lng < HENLEY_BBOX.minLng || c.lng > HENLEY_BBOX.maxLng
    );
    expect(outOfBounds.length).toBe(0);
  });
  
  it('The Leviathan\'s Wake (Thames Tideway) is a 6.8km Championship Course', () => {
    const routes = routeService.getAllRoutes();
    const thames = routes.find(r => r.id === '5')!;
    
    expect(thames.name).toBe('The Leviathan\'s Wake');
    expect(thames.distance).toBeCloseTo(6.8, 1); // 6.8km Championship Course
    expect(thames.difficulty).toBe('hard');
    expect(thames.tags).toContain('tidal');
    expect(thames.tags).toContain('dystopian');
    expect(thames.tags).toContain('long-distance');
    
    // Check coordinates are within Thames Tideway area
    const coords = thames.coordinates;
    const outOfBounds = coords.filter(c =>
      c.lat < THAMES_BBOX.minLat || c.lat > THAMES_BBOX.maxLat ||
      c.lng < THAMES_BBOX.minLng || c.lng > THAMES_BBOX.maxLng
    );
    expect(outOfBounds.length).toBe(0);
  });
  
  it('The Architect\'s Infinite Equation (Charles River) is a 4.8km Head race course', () => {
    const routes = routeService.getAllRoutes();
    const charles = routes.find(r => r.id === '6')!;
    
    expect(charles.name).toBe('The Architect\'s Infinite Equation');
    expect(charles.distance).toBeCloseTo(4.8, 1); // 4.8km Head of the Charles
    expect(charles.difficulty).toBe('moderate');
    expect(charles.tags).toContain('academic');
    expect(charles.tags).toContain('sci-fi');
    expect(charles.tags).toContain('bridges');
    
    // Check coordinates are within Charles River area (Boston/Cambridge)
    const coords = charles.coordinates;
    const outOfBounds = coords.filter(c =>
      c.lat < CHARLES_BBOX.minLat || c.lat > CHARLES_BBOX.maxLat ||
      c.lng < CHARLES_BBOX.minLng || c.lng > CHARLES_BBOX.maxLng
    );
    expect(outOfBounds.length).toBe(0);
  });
  
  it('all fantasy routes have different difficulty levels', () => {
    const routes = routeService.getAllRoutes();
    const fantasyRoutes = routes.filter(r => ['2', '3', '4', '5', '6'].includes(r.id));
    
    const difficulties = fantasyRoutes.map(r => r.difficulty);
    expect(difficulties).toContain('easy');      // Lake Bled
    expect(difficulties).toContain('moderate');  // Venice, Charles River
    expect(difficulties).toContain('hard');      // Henley, Thames
  });
  
  it('all fantasy routes have distinct fantasy/sci-fi themes', () => {
    const routes = routeService.getAllRoutes();
    
    // Lake Bled: elven/crystal fantasy
    const bled = routes.find(r => r.id === '2')!;
    expect(bled.tags).toContain('elven');
    expect(bled.tags).toContain('crystal');
    
    // Venice: gothic/spectral
    const venice = routes.find(r => r.id === '3')!;
    expect(venice.tags).toContain('gothic');
    expect(venice.tags).toContain('haunted');
    
    // Henley: steampunk/victorian
    const henley = routes.find(r => r.id === '4')!;
    expect(henley.tags).toContain('steampunk');
    expect(henley.tags).toContain('victorian');
    
    // Thames: dystopian/kaiju
    const thames = routes.find(r => r.id === '5')!;
    expect(thames.tags).toContain('dystopian');
    expect(thames.tags).toContain('kaiju');
    
    // Charles: sci-fi/geometric
    const charles = routes.find(r => r.id === '6')!;
    expect(charles.tags).toContain('sci-fi');
    expect(charles.tags).toContain('geometric');
  });
});

describe('RouteService creation & search', () => {
  it('creates a custom route and computes distance', () => {
    const newRoute = routeService.createRoute({
      name: 'Test Custom',
      description: 'Test route',
      location: 'Testland',
      difficulty: 'easy',
      coordinates: [
        { lat: 40.785, lng: -73.96 },
        { lat: 40.786, lng: -73.959 },
        { lat: 40.787, lng: -73.958 },
      ],
      tags: ['test'],
      imageUrl: undefined,
    });
    expect(newRoute.distance).toBeGreaterThan(0);
    expect(newRoute.source).toBeUndefined();
    const found = routeService.searchRoutes('Test Custom');
    expect(found.some(r => r.id === newRoute.id)).toBe(true);
  });

  it('creates a rownative route with source metadata', () => {
    const route = routeService.importRouteFromRownative({
      id: '99',
      name: 'Sample Rownative Course',
      country: 'Netherlands',
      distanceMeters: 5000,
      coordinates: [
        { lat: 52.37, lng: 4.89 },
        { lat: 52.38, lng: 4.9 },
      ],
      status: 'established',
    });

    expect(route.source).toBe('rownative');
    expect(route.distance).toBe(5);
    expect(route.tags).toContain('rownative');
    expect(route.tags).toContain('status:established');
  });

  it('does not add a status tag when rownative status is missing', () => {
    const route = routeService.importRouteFromRownative({
      id: '100',
      name: 'Statusless Course',
      country: 'Canada',
      distanceMeters: 3000,
      coordinates: [
        { lat: 45.42, lng: -75.69 },
        { lat: 45.43, lng: -75.68 },
      ],
    });

    expect(route.tags).toContain('rownative');
    expect(route.tags.some((tag) => tag.startsWith('status:'))).toBe(false);
  });
});

describe('RouteService import routines', () => {
  it('imports a GPX route', () => {
    const gpx = `<?xml version="1.0"?><gpx><trk><trkseg><trkpt lat="40.785" lon="-73.96" /><trkpt lat="40.786" lon="-73.959" /></trkseg></trk></gpx>`;
    const imported = routeService.importRouteFromGPX(gpx, { name: 'GPX Water', difficulty: 'easy' });
    expect(imported).toBeDefined();
    expect(imported!.coordinates.length).toBe(2);
  });

  it('imports any GPX route without water validation', () => {
    const gpx = `<?xml version="1.0"?><gpx><trk><trkseg><trkpt lat="0" lon="0" /><trkpt lat="0.001" lon="0.001" /></trkseg></trk></gpx>`;
    const imported = routeService.importRouteFromGPX(gpx, { name: 'GPX Any', difficulty: 'easy' });
    expect(imported).toBeDefined();
    expect(imported!.coordinates.length).toBe(2);
  });

  it('imports a GeoJSON LineString route', () => {
    const geojson = JSON.stringify({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: [ [-73.962, 40.786], [-73.961, 40.787] ] },
      properties: {}
    });
    const imported = routeService.importRouteFromGeoJSON(geojson, { name: 'GeoJSON Test', difficulty: 'moderate' });
    expect(imported).toBeDefined();
    expect(imported!.coordinates.length).toBeGreaterThan(0);
  });

  it('imports any GeoJSON route without water validation', () => {
    const geojson = JSON.stringify({ type: 'Feature', geometry: { type: 'LineString', coordinates: [[0,0],[0.001,0.001]] }, properties: {} });
    const imported = routeService.importRouteFromGeoJSON(geojson, { name: 'GeoJSON Any', difficulty: 'easy' });
    expect(imported).toBeDefined();
    expect(imported!.coordinates.length).toBe(2);
  });

  it('skips out-of-range GeoJSON positions and keeps valid [lng,lat] points', () => {
    const geojson = JSON.stringify({
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: [[181, 0], [13.405, 52.52], [13.406, 52.521]],
      },
      properties: {},
    });
    const imported = routeService.importRouteFromGeoJSON(geojson, { name: 'GeoJSON Filtered', difficulty: 'easy' });
    expect(imported).toBeDefined();
    expect(imported!.coordinates).toEqual([
      { lat: 52.52, lng: 13.405 },
      { lat: 52.521, lng: 13.406 },
    ]);
  });
});

describe('RouteService KML import', () => {
  it('imports a single-placemark KML route', () => {
    const kml = `<?xml version="1.0"?><kml><Document><Placemark><name>Test Route</name><LineString><coordinates>-73.962,40.786 -73.961,40.787 -73.960,40.788</coordinates></LineString></Placemark></Document></kml>`;
    const result = routeService.importRouteFromKML(kml, { difficulty: 'easy' });
    expect(result.status).toBe('success');
    if (result.status === 'success') {
      expect(result.route.coordinates.length).toBe(3);
      expect(result.route.name).toBe('Test Route');
      expect(result.route.source).toBe('imported');
    }
  });

  it('extracts name from <name> element and ignores altitude', () => {
    const kml = `<?xml version="1.0"?><kml><Document><Placemark><name>Altitude Route</name><LineString><coordinates>-73.962,40.786,10 -73.961,40.787,20</coordinates></LineString></Placemark></Document></kml>`;
    const result = routeService.importRouteFromKML(kml, {});
    expect(result.status).toBe('success');
    if (result.status === 'success') {
      expect(result.route.coordinates.length).toBe(2);
      expect(result.route.name).toBe('Altitude Route');
    }
  });

  it('parses KML with xml namespace declaration', () => {
    const kml = `<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><Placemark><name>Namespaced</name><LineString><coordinates>-73.962,40.786 -73.961,40.787</coordinates></LineString></Placemark></Document></kml>`;
    const result = routeService.importRouteFromKML(kml, {});
    expect(result.status).toBe('success');
    if (result.status === 'success') {
      expect(result.route.coordinates.length).toBe(2);
    }
  });

  it('returns selectionRequired for multi-placemark KML', () => {
    const kml = `<?xml version="1.0"?><kml><Document>
      <Placemark><name>Leg 1</name><LineString><coordinates>-73.962,40.786 -73.961,40.787</coordinates></LineString></Placemark>
      <Placemark><name>Leg 2</name><LineString><coordinates>-73.960,40.788 -73.959,40.789</coordinates></LineString></Placemark>
    </Document></kml>`;
    const result = routeService.importRouteFromKML(kml, {});
    expect(result.status).toBe('selectionRequired');
    if (result.status === 'selectionRequired') {
      expect(result.candidates.length).toBe(2);
      expect(result.candidates[0].name).toBe('Leg 1');
      expect(result.candidates[1].name).toBe('Leg 2');
    }
  });

  it('finalizeKMLImport creates a route from a candidate', () => {
    const candidate = { name: 'Selected', description: 'desc', coordinates: [{ lat: 40.786, lng: -73.962 }, { lat: 40.787, lng: -73.961 }] };
    const route = routeService.finalizeKMLImport(candidate, { difficulty: 'hard' });
    expect(route.name).toBe('Selected');
    expect(route.difficulty).toBe('hard');
    expect(route.coordinates.length).toBe(2);
  });

  it('returns error for invalid XML', () => {
    const result = routeService.importRouteFromKML('<not valid xml <<<', {});
    expect(result.status).toBe('error');
    if (result.status === 'error') {
      expect(result.error).toMatch(/invalid xml/i);
    }
  });

  it('returns error for non-KML XML', () => {
    const result = routeService.importRouteFromKML('<?xml version="1.0"?><gpx><trk></trk></gpx>', {});
    expect(result.status).toBe('error');
    if (result.status === 'error') {
      expect(result.error).toMatch(/kml/i);
    }
  });

  it('returns error when no Placemark elements present', () => {
    const result = routeService.importRouteFromKML('<?xml version="1.0"?><kml><Document></Document></kml>', {});
    expect(result.status).toBe('error');
    if (result.status === 'error') {
      expect(result.error).toMatch(/placemark/i);
    }
  });

  it('returns error when no LineString with ≥2 valid points found', () => {
    const result = routeService.importRouteFromKML('<?xml version="1.0"?><kml><Document><Placemark><name>Bad</name><LineString><coordinates>-73.962,40.786</coordinates></LineString></Placemark></Document></kml>', {});
    expect(result.status).toBe('error');
  });

  it('skips malformed coordinate tuples (e.g. -122.1,abc,0)', () => {
    const kml = `<?xml version="1.0"?><kml><Document><Placemark><name>Mixed</name><LineString><coordinates>-73.962,40.786 -73.961,abc,0 -73.960,40.788</coordinates></LineString></Placemark></Document></kml>`;
    const result = routeService.importRouteFromKML(kml, {});
    expect(result.status).toBe('success');
    if (result.status === 'success') {
      // Malformed tuple is skipped; valid points remain
      expect(result.route.coordinates.length).toBe(2);
    }
  });

  it('handles coordinates with tabs and multiple spaces', () => {
    const kml = `<?xml version="1.0"?><kml><Document><Placemark><name>Whitespace</name><LineString><coordinates>
      -73.962,40.786,0\t\t-73.961,40.787,0
      -73.960,40.788,0
    </coordinates></LineString></Placemark></Document></kml>`;
    const result = routeService.importRouteFromKML(kml, {});
    expect(result.status).toBe('success');
    if (result.status === 'success') {
      expect(result.route.coordinates.length).toBe(3);
    }
  });

  it('overrides KML name with meta.name when provided', () => {
    const kml = `<?xml version="1.0"?><kml><Document><Placemark><name>KML Name</name><LineString><coordinates>-73.962,40.786 -73.961,40.787</coordinates></LineString></Placemark></Document></kml>`;
    const result = routeService.importRouteFromKML(kml, { name: 'Custom Name' });
    expect(result.status).toBe('success');
    if (result.status === 'success') {
      expect(result.route.name).toBe('Custom Name');
    }
  });

  it('uses Document-level name as fallback when Placemark has no name', () => {
    const kml = `<?xml version="1.0"?><kml><Document><name>Doc Name</name><Placemark><LineString><coordinates>-73.962,40.786 -73.961,40.787</coordinates></LineString></Placemark></Document></kml>`;
    const result = routeService.importRouteFromKML(kml, {});
    expect(result.status).toBe('success');
    if (result.status === 'success') {
      expect(result.route.name).toBe('Doc Name');
    }
  });
});
