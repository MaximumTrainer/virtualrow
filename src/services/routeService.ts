import type { WaterRoute, Coordinate, RouteFormData } from '../types/index';

/** A parsed KML placemark with its coordinate sequence, ready to import as a route. */
export interface KMLImportCandidate {
  name: string;
  description: string;
  coordinates: Coordinate[];
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

// ==========================================
// FANTASY ROUTES BASED ON REAL-WORLD LOCATIONS
// ==========================================

// LAKE BLED, SLOVENIA - "Crystal Sanctum of Bled"
// Real geography: 2,120m × 1,380m alpine lake, central island with church, Bled Castle on north shore
// Center coordinates: 46.3644°N, 14.0947°E (~6km circular route around the lake)
// Fantasy theme: Ethereal floating crystal towers, bioluminescent waters, ancient elven sanctuaries
const lakebledCoordinates: Coordinate[] = [
  // Start/End at eastern shore near Bled town (roughly where Grand Hotel Toplice is)
  {lat:46.3685,lng:14.1050}, // Start - eastern shore
  // Northern shore (passes below where Bled Castle sits on the cliff)
  {lat:46.3700,lng:14.1020},{lat:46.3715,lng:14.0990},{lat:46.3725,lng:14.0955},
  {lat:46.3730,lng:14.0920},{lat:46.3728,lng:14.0885},{lat:46.3720,lng:14.0852},
  // Northwest curve
  {lat:46.3705,lng:14.0825},{lat:46.3688,lng:14.0800},{lat:46.3668,lng:14.0785},
  // Western shore (scenic views toward the Julian Alps)
  {lat:46.3648,lng:14.0778},{lat:46.3625,lng:14.0780},{lat:46.3602,lng:14.0790},
  {lat:46.3580,lng:14.0808},{lat:46.3562,lng:14.0830},
  // Southern curve (closest approach to island - Bled Island with Assumption Church)
  {lat:46.3550,lng:14.0858},{lat:46.3545,lng:14.0890},{lat:46.3548,lng:14.0925},
  {lat:46.3555,lng:14.0958},{lat:46.3568,lng:14.0988},
  // Southeastern shore
  {lat:46.3585,lng:14.1012},{lat:46.3605,lng:14.1030},{lat:46.3628,lng:14.1042},
  {lat:46.3652,lng:14.1048},{lat:46.3675,lng:14.1050},
  // Complete the loop back to start
  {lat:46.3685,lng:14.1050}, // End - same as start for circular route
];

// VENICE GRAND CANAL - "Canale delle Anime Perdute" (Canal of Lost Souls)
// Real geography: 3.8km long, reverse S-shape, 30-90m wide
// Runs from Santa Lucia station (45.4410°N, 12.3208°E) to St. Mark's Basin (45.4318°N, 12.3385°E)
// Four bridges: Costituzione, Scalzi, Rialto, Accademia
// Fantasy theme: Gothic spectral Venice, phantom gondoliers, sunken palaces rising from the depths
const veniceGrandCanalCoordinates: Coordinate[] = [
  // Start at Santa Lucia Train Station / Piazzale Roma (northwest)
  {lat:45.4410,lng:12.3208},
  // Ponte della Costituzione (Calatrava Bridge) area
  {lat:45.4405,lng:12.3220},
  // Ponte degli Scalzi area
  {lat:45.4395,lng:12.3240},
  // First S-curve bend - sweeping southeast toward San Marcuola
  {lat:45.4380,lng:12.3265},{lat:45.4365,lng:12.3285},{lat:45.4350,lng:12.3305},
  // Past Palazzo Vendramin-Calergi (Casino), Ca' d'Oro approach
  {lat:45.4395,lng:12.3320},{lat:45.4405,lng:12.3340},
  // Ca' d'Oro (Golden Palace) - the curve peak
  {lat:45.4410,lng:12.3360},
  // Curving down toward Rialto Bridge
  {lat:45.4400,lng:12.3375},{lat:45.4388,lng:12.3385},
  // Rialto Bridge - iconic single arch stone bridge
  {lat:45.4380,lng:12.3390},
  // Second S-curve - turning southwest past San Polo
  {lat:45.4368,lng:12.3395},{lat:45.4355,lng:12.3405},{lat:45.4342,lng:12.3420},
  // Ca' Foscari / Ca' Rezzonico area
  {lat:45.4335,lng:12.3435},{lat:45.4332,lng:12.3450},
  // Ponte dell'Accademia area
  {lat:45.4330,lng:12.3465},
  // Final stretch - curving east toward San Marco
  {lat:45.4325,lng:12.3480},{lat:45.4320,lng:12.3500},
  // Palazzo Barbarigo, Peggy Guggenheim Collection
  {lat:45.4318,lng:12.3520},
  // Santa Maria della Salute - iconic domed basilica
  {lat:45.4318,lng:12.3545},
  // End at St. Mark's Basin (Punta della Dogana)
  {lat:45.4318,lng:12.3385},
];

// HENLEY ROYAL REGATTA - "The Iron Sovereign's Gauntlet"
// Real geography: 2,112m (1 mile 550 yards) straight course, 51.5486°N 0.8942°W
// Runs from Temple Island downstream to Phyllis Court/Henley Bridge
// Fantasy theme: Steampunk Victorian, brass automatons, clockwork timing towers
const henleyCoordinates: Coordinate[] = [
  // Start at Temple Island (the famous small island at the start)
  {lat:51.5598,lng:-0.9102},
  // Straight racing course down the Thames
  {lat:51.5590,lng:-0.9085},{lat:51.5582,lng:-0.9068},{lat:51.5574,lng:-0.9050},
  {lat:51.5565,lng:-0.9032},{lat:51.5556,lng:-0.9015},{lat:51.5547,lng:-0.8998},
  {lat:51.5538,lng:-0.8980},{lat:51.5529,lng:-0.8962},{lat:51.5520,lng:-0.8945},
  {lat:51.5511,lng:-0.8928},{lat:51.5502,lng:-0.8910},{lat:51.5493,lng:-0.8892},
  {lat:51.5484,lng:-0.8875},{lat:51.5475,lng:-0.8858},{lat:51.5466,lng:-0.8840},
  {lat:51.5457,lng:-0.8822},{lat:51.5448,lng:-0.8805},{lat:51.5439,lng:-0.8788},
  // Finish line near Phyllis Court/Henley Bridge
  {lat:51.5430,lng:-0.8772},{lat:51.5422,lng:-0.8758},
];

// THAMES TIDEWAY - "The Leviathan's Wake"
// Real geography: 6.8km (4.25 miles) from Mortlake to Putney (Championship Course in reverse)
// Coordinates roughly 51.4800°N 0.2700°W, passes Chiswick, Hammersmith, Barnes
// Fantasy theme: Kaiju-sized sea creatures beneath, neo-noir dystopian London
const thamesTidewayCoordinates: Coordinate[] = [
  // Start near Mortlake (where the Boat Race finishes)
  {lat:51.4680,lng:-0.2678},
  // Past Chiswick Bridge
  {lat:51.4698,lng:-0.2615},{lat:51.4715,lng:-0.2550},{lat:51.4728,lng:-0.2485},
  // Barnes railway bridge area
  {lat:51.4738,lng:-0.2418},{lat:51.4745,lng:-0.2350},{lat:51.4750,lng:-0.2282},
  // Hammersmith Bridge (iconic green suspension bridge)
  {lat:51.4755,lng:-0.2215},{lat:51.4760,lng:-0.2148},{lat:51.4768,lng:-0.2082},
  // Approaching Craven Cottage (Fulham FC stadium on south bank)
  {lat:51.4778,lng:-0.2018},{lat:51.4790,lng:-0.1955},{lat:51.4802,lng:-0.1892},
  // Past Putney Pier
  {lat:51.4815,lng:-0.1830},{lat:51.4828,lng:-0.1768},{lat:51.4838,lng:-0.1708},
  // Finish near Putney Bridge (where the Boat Race starts)
  {lat:51.4848,lng:-0.1648},{lat:51.4855,lng:-0.1592},{lat:51.4862,lng:-0.1538},
];

// CHARLES RIVER, BOSTON - "The Architect's Infinite Equation"
// Real geography: 4.8km (3 miles) Head of the Charles course, 42.3625°N 71.1181°W
// From BU DeWolfe Boathouse to past Eliot Bridge, passes Harvard, MIT boathouses
// Fantasy theme: Reality-bending academic magic, impossible geometries, tesseract architecture
const charlesRiverCoordinates: Coordinate[] = [
  // Start near BU DeWolfe Boathouse / Charles River Basin
  {lat:42.3528,lng:-71.1102},
  // Past BU Bridge (Grand Junction Railroad crossing)
  {lat:42.3542,lng:-71.1128},{lat:42.3558,lng:-71.1155},{lat:42.3575,lng:-71.1182},
  // River Street Bridge area
  {lat:42.3590,lng:-71.1208},{lat:42.3605,lng:-71.1232},{lat:42.3618,lng:-71.1255},
  // Western Avenue Bridge
  {lat:42.3630,lng:-71.1278},{lat:42.3642,lng:-71.1302},{lat:42.3655,lng:-71.1328},
  // John W. Weeks Footbridge (famous pedestrian bridge to Harvard)
  {lat:42.3668,lng:-71.1352},{lat:42.3680,lng:-71.1375},{lat:42.3692,lng:-71.1398},
  // Anderson Memorial Bridge (near Harvard's Weld Boathouse)
  {lat:42.3705,lng:-71.1422},{lat:42.3718,lng:-71.1448},{lat:42.3730,lng:-71.1472},
  // Finish past Eliot Bridge, near Henderson Boathouse
  {lat:42.3742,lng:-71.1495},{lat:42.3752,lng:-71.1518},{lat:42.3762,lng:-71.1542},
];

// ==========================================
// ORIGINAL WILLOWBROOK RIVER ROUTE
// ==========================================

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
      for (const c of geometry.coordinates as number[][]) {
        coords.push({ lat: c[1], lng: c[0] });
      }
    } else if (geometry.type === 'MultiLineString' && geometry.coordinates) {
      for (const ln of geometry.coordinates as number[][][]) {
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

  // ── KML import ──────────────────────────────────────────────────────────

  /**
   * Parse the text content of a KML <coordinates> element into Coordinate[].
   * Each tuple is "lng,lat[,alt]"; altitude is ignored.
   * Tuples that are not finite numbers or are out of valid lat/lng range are skipped.
   */
  private parseKMLCoordinates(text: string): Coordinate[] {
    const tuples = text.trim().split(/\s+/).filter((s) => s.length > 0);
    const coords: Coordinate[] = [];
    for (const tuple of tuples) {
      const parts = tuple.split(',');
      if (parts.length < 2) continue;
      const lngStr = parts[0].trim();
      const latStr = parts[1].trim();
      if (!this.isValidNumericString(lngStr) || !this.isValidNumericString(latStr)) continue;
      const lng = parseFloat(lngStr);
      const lat = parseFloat(latStr);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      if (lat < -90 || lat > 90 || lng < -180 || lng > 180) continue;
      coords.push({ lat, lng });
    }
    return coords;
  }

  /** Strict check: string represents a valid decimal or scientific-notation number. */
  private isValidNumericString(s: string): boolean {
    return /^[-+]?[0-9]*\.?[0-9]+([eE][-+]?[0-9]+)?$/.test(s.trim());
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
