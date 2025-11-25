import type { WaterRoute, Coordinate, RouteFormData } from '../types/index';

// Import coordinate arrays from parsed GPX files
import { charlesRiverCoordinates } from '../../scripts/charlesriver-coords';
import { lakeBledCoordinates } from '../../scripts/lakebled-coords';
import { riverThamesCoordinates } from '../../scripts/riverthames-coords';

// Venice route coordinates parsed from GPX file
const veniceCoordinates: Coordinate[] = [
  {"lat":45.447707,"lng":12.333061},{"lat":45.447707,"lng":12.333061},{"lat":45.447707,"lng":12.333061},{"lat":45.447707,"lng":12.333061},{"lat":45.447707,"lng":12.333061},{"lat":45.447707,"lng":12.333061},{"lat":45.447707,"lng":12.333061},{"lat":45.447707,"lng":12.333061},{"lat":45.447707,"lng":12.333061},{"lat":45.447707,"lng":12.333061},{"lat":45.447707,"lng":12.333061},{"lat":45.447707,"lng":12.333061},{"lat":45.447707,"lng":12.333061},{"lat":45.447707,"lng":12.333061},{"lat":45.447707,"lng":12.333061},{"lat":45.447707,"lng":12.333061},{"lat":45.447707,"lng":12.333061},{"lat":45.447707,"lng":12.333061},{"lat":45.447707,"lng":12.333061},{"lat":45.447707,"lng":12.333061},{"lat":45.447707,"lng":12.333061},{"lat":45.447707,"lng":12.333061},{"lat":45.447707,"lng":12.333061},{"lat":45.447707,"lng":12.333061},{"lat":45.447707,"lng":12.333061},{"lat":45.447707,"lng":12.333061},{"lat":45.447707,"lng":12.333061},{"lat":45.447707,"lng":12.333061},{"lat":45.447707,"lng":12.333061},{"lat":45.447707,"lng":12.333061},{"lat":45.447707,"lng":12.333061},{"lat":45.447707,"lng":12.333061},{"lat":45.447707,"lng":12.333061},{"lat":45.447707,"lng":12.333061},{"lat":45.447707,"lng":12.333061},{"lat":45.447707,"lng":12.333061},{"lat":45.447707,"lng":12.333061},{"lat":45.447707,"lng":12.333061},{"lat":45.447707,"lng":12.333061},{"lat":45.447707,"lng":12.333061},{"lat":45.447707,"lng":12.333061},{"lat":45.447707,"lng":12.333061},{"lat":45.447707,"lng":12.333061},{"lat":45.447707,"lng":12.333061},{"lat":45.447707,"lng":12.333061},{"lat":45.447707,"lng":12.333061},{"lat":45.447707,"lng":12.333061},{"lat":45.447707,"lng":12.333061},{"lat":45.447707,"lng":12.333061},{"lat":45.447707,"lng":12.333061},{"lat":45.447798,"lng":12.333098},{"lat":45.447873,"lng":12.333182},{"lat":45.447955,"lng":12.333263},{"lat":45.448035,"lng":12.333354},{"lat":45.44811,"lng":12.333451},{"lat":45.448185,"lng":12.333544},{"lat":45.448264,"lng":12.333629},{"lat":45.448335,"lng":12.333721},{"lat":45.448415,"lng":12.333804},{"lat":45.448499,"lng":12.333883},{"lat":45.448578,"lng":12.333964},{"lat":45.448662,"lng":12.334041},{"lat":45.448748,"lng":12.334113},{"lat":45.448836,"lng":12.334181},{"lat":45.448926,"lng":12.334243},{"lat":45.449015,"lng":12.334305},{"lat":45.449108,"lng":12.334364},{"lat":45.449201,"lng":12.334416},{"lat":45.449296,"lng":12.334465},{"lat":45.449391,"lng":12.334511},{"lat":45.449491,"lng":12.334551},{"lat":45.449551,"lng":12.334529},{"lat":45.449502,"lng":12.334423},{"lat":45.449436,"lng":12.334332},{"lat":45.44937,"lng":12.334242},{"lat":45.449298,"lng":12.334156},{"lat":45.44922,"lng":12.334076},{"lat":45.449137,"lng":12.334001},{"lat":45.449052,"lng":12.333932},{"lat":45.448962,"lng":12.333867},{"lat":45.448869,"lng":12.333808},{"lat":45.448774,"lng":12.333752},{"lat":45.448676,"lng":12.333703},{"lat":45.448577,"lng":12.333656},{"lat":45.448475,"lng":12.333616},{"lat":45.448371,"lng":12.333581},{"lat":45.448266,"lng":12.333551},{"lat":45.448159,"lng":12.333527},{"lat":45.448051,"lng":12.333507},{"lat":45.447942,"lng":12.333495},{"lat":45.447833,"lng":12.333488},{"lat":45.447723,"lng":12.333488},{"lat":45.447613,"lng":12.333493},{"lat":45.447504,"lng":12.333504},{"lat":45.447395,"lng":12.333519},{"lat":45.447287,"lng":12.33354},{"lat":45.447181,"lng":12.333565},{"lat":45.447076,"lng":12.333595},{"lat":45.446972,"lng":12.333629},{"lat":45.44687,"lng":12.333666},{"lat":45.44677,"lng":12.333708},{"lat":45.446672,"lng":12.333751},{"lat":45.446576,"lng":12.333798},{"lat":45.446483,"lng":12.333847},{"lat":45.446391,"lng":12.333898},{"lat":45.446302,"lng":12.333952},{"lat":45.446215,"lng":12.334007},{"lat":45.446131,"lng":12.334064},{"lat":45.446049,"lng":12.334122},{"lat":45.44597,"lng":12.334182},{"lat":45.445894,"lng":12.334243},{"lat":45.44582,"lng":12.334305},{"lat":45.44575,"lng":12.334369},{"lat":45.445683,"lng":12.334432},{"lat":45.445619,"lng":12.334497},{"lat":45.445559,"lng":12.334562},{"lat":45.445503,"lng":12.334628},{"lat":45.44545,"lng":12.334693},{"lat":45.445402,"lng":12.334759},{"lat":45.445357,"lng":12.334825},{"lat":45.445317,"lng":12.33489},{"lat":45.445281,"lng":12.334955},{"lat":45.44525,"lng":12.335019},{"lat":45.445223,"lng":12.335083},{"lat":45.445201,"lng":12.335146},{"lat":45.445183,"lng":12.335207},{"lat":45.445171,"lng":12.335268},{"lat":45.445163,"lng":12.335327},{"lat":45.44516,"lng":12.335385},{"lat":45.445162,"lng":12.335442},{"lat":45.445169,"lng":12.335498},{"lat":45.44518,"lng":12.335552},{"lat":45.445197,"lng":12.335605},{"lat":45.445218,"lng":12.335655},{"lat":45.445244,"lng":12.335704},{"lat":45.445274,"lng":12.33575},{"lat":45.445309,"lng":12.335795},{"lat":45.445348,"lng":12.335836},{"lat":45.445391,"lng":12.335875},{"lat":45.445438,"lng":12.335912},{"lat":45.445489,"lng":12.335945},{"lat":45.445543,"lng":12.335976},{"lat":45.445601,"lng":12.336003},{"lat":45.445662,"lng":12.336028},{"lat":45.445725,"lng":12.33605},{"lat":45.445791,"lng":12.336067},{"lat":45.445859,"lng":12.336082},{"lat":45.445929,"lng":12.336093},{"lat":45.446,"lng":12.3361},{"lat":45.446073,"lng":12.336104},{"lat":45.446147,"lng":12.336104},{"lat":45.446222,"lng":12.336101},{"lat":45.446297,"lng":12.336094},{"lat":45.446373,"lng":12.336083},{"lat":45.446449,"lng":12.336069},{"lat":45.446525,"lng":12.336051},{"lat":45.446601,"lng":12.33603},{"lat":45.446676,"lng":12.336005},{"lat":45.446751,"lng":12.335977},{"lat":45.446824,"lng":12.335946},{"lat":45.446896,"lng":12.335912},{"lat":45.446967,"lng":12.335875},{"lat":45.447035,"lng":12.335835},{"lat":45.447102,"lng":12.335792},{"lat":45.447167,"lng":12.335747},{"lat":45.447229,"lng":12.335699},{"lat":45.447289,"lng":12.335649},{"lat":45.447346,"lng":12.335597},{"lat":45.4474,"lng":12.335543},{"lat":45.44745,"lng":12.335486},{"lat":45.447498,"lng":12.335428},{"lat":45.447542,"lng":12.335368},{"lat":45.447583,"lng":12.335306},{"lat":45.447619,"lng":12.335243},{"lat":45.447652,"lng":12.335179},{"lat":45.44768,"lng":12.335113},{"lat":45.447705,"lng":12.335046},{"lat":45.447725,"lng":12.334978},{"lat":45.447741,"lng":12.33491},{"lat":45.447753,"lng":12.334841},{"lat":45.44776,"lng":12.334771},{"lat":45.447763,"lng":12.334701},{"lat":45.447761,"lng":12.334631},{"lat":45.447755,"lng":12.33456},{"lat":45.447744,"lng":12.33449},{"lat":45.447729,"lng":12.33442},{"lat":45.44771,"lng":12.33435},{"lat":45.447686,"lng":12.334281},{"lat":45.447658,"lng":12.334212},{"lat":45.447626,"lng":12.334145},{"lat":45.447589,"lng":12.334078},{"lat":45.447554,"lng":12.318586},{"lat":45.447301,"lng":12.31841},{"lat":45.447027,"lng":12.318319},{"lat":45.44679,"lng":12.318482},{"lat":45.446639,"lng":12.318815},{"lat":45.446511,"lng":12.319168},{"lat":45.446359,"lng":12.319499},{"lat":45.446179,"lng":12.31978},{"lat":45.446001,"lng":12.320077},{"lat":45.445822,"lng":12.320364},{"lat":45.445631,"lng":12.320644},{"lat":45.445454,"lng":12.320944},{"lat":45.445314,"lng":12.321286},{"lat":45.445173,"lng":12.32162},{"lat":45.445093,"lng":12.32198},{"lat":45.444999,"lng":12.322344},{"lat":45.444906,"lng":12.322713},{"lat":45.444792,"lng":12.323073},{"lat":45.444682,"lng":12.323425},{"lat":45.444541,"lng":12.323757},{"lat":45.444366,"lng":12.324057},{"lat":45.444184,"lng":12.324433},{"lat":45.44402,"lng":12.324792},{"lat":45.443853,"lng":12.325114},{"lat":45.443701,"lng":12.325425},{"lat":45.443512,"lng":12.325706},{"lat":45.443274,"lng":12.325888},{"lat":45.443006,"lng":12.325964},{"lat":45.442739,"lng":12.326073},{"lat":45.442478,"lng":12.32616},{"lat":45.442273,"lng":12.326385},{"lat":45.442192,"lng":12.326743},{"lat":45.442204,"lng":12.327135},{"lat":45.442263,"lng":12.327518},{"lat":45.442251,"lng":12.327899},{"lat":45.442243,"lng":12.328275},{"lat":45.442241,"lng":12.328659},{"lat":45.442232,"lng":12.329036},{"lat":45.442258,"lng":12.329415},{"lat":45.442241,"lng":12.329797},{"lat":45.44221,"lng":12.330171},{"lat":45.442144,"lng":12.330537},{"lat":45.442051,"lng":12.330881},{"lat":45.441948,"lng":12.33122},{"lat":45.441815,"lng":12.33156},{"lat":45.441656,"lng":12.33188},{"lat":45.441485,"lng":12.332195},{"lat":45.441311,"lng":12.332512},{"lat":45.441161,"lng":12.332837},{"lat":45.440939,"lng":12.333062},{"lat":45.440731,"lng":12.333337},{"lat":45.440525,"lng":12.333613},{"lat":45.440364,"lng":12.333936},{"lat":45.44024,"lng":12.334277},{"lat":45.440111,"lng":12.334626},{"lat":45.439955,"lng":12.334948},{"lat":45.439772,"lng":12.335243},{"lat":45.439568,"lng":12.335504},{"lat":45.439318,"lng":12.335666},{"lat":45.439089,"lng":12.335859},{"lat":45.438859,"lng":12.336043},{"lat":45.438615,"lng":12.336167},{"lat":45.438354,"lng":12.336142},{"lat":45.438101,"lng":12.336033},{"lat":45.437892,"lng":12.335826},{"lat":45.437732,"lng":12.335561},{"lat":45.437543,"lng":12.33528},{"lat":45.437348,"lng":12.335029},{"lat":45.437179,"lng":12.334719},{"lat":45.437031,"lng":12.334374},{"lat":45.436877,"lng":12.334045},{"lat":45.436745,"lng":12.333701},{"lat":45.436645,"lng":12.333346},{"lat":45.43652,"lng":12.332985},{"lat":45.436414,"lng":12.332617},{"lat":45.436284,"lng":12.332276},{"lat":45.436167,"lng":12.331927},{"lat":45.436079,"lng":12.331573},{"lat":45.435989,"lng":12.33121},{"lat":45.43588,"lng":12.33085},{"lat":45.435777,"lng":12.330449}
];

// Henley Rowing route coordinates parsed from GPX file
const henleyCoordinates: Coordinate[] = [
  {"lat":51.533121097427276,"lng":-0.8969430470461178},{"lat":51.53332869618822,"lng":-0.8972660232813968},{"lat":51.53376895679836,"lng":-0.897230156473417},{"lat":51.53447230300798,"lng":-0.898399013939067},{"lat":51.53551026822421,"lng":-0.9000140052703001},{"lat":51.53593739840256,"lng":-0.9002560277970028},{"lat":51.53650824369671,"lng":-0.900721680459468},{"lat":51.53690556194955,"lng":-0.901141058082337},{"lat":51.537583694395806,"lng":-0.9013013584111272},{"lat":51.53759328374021,"lng":-0.9006450803330454},{"lat":51.53747464794531,"lng":-0.899739567310786},{"lat":51.53750138050963,"lng":-0.8992342720851326},{"lat":51.53781744139191,"lng":-0.8993780451124181},{"lat":51.537913962952686,"lng":-0.8996028122389561},{"lat":51.53801048408688,"lng":-0.8998275803199423},{"lat":51.54016459330213,"lng":-0.8996494784118874},{"lat":51.54049402016548,"lng":-0.8995405982456992},{"lat":51.541822250237125,"lng":-0.8985496391729392},{"lat":51.54357144330035,"lng":-0.8971446763194196},{"lat":51.545276982841884,"lng":-0.8961192137344601},{"lat":51.5464335547516,"lng":-0.89528363068},{"lat":51.56026591875624,"lng":-0.8853806498721073},{"lat":51.55964670353466,"lng":-0.8864560675477812},{"lat":51.55900672149183,"lng":-0.8870018286624113},{"lat":51.558649672456056,"lng":-0.8875154281488769},{"lat":51.558192489274276,"lng":-0.8874256048385638},{"lat":51.5567680568628,"lng":-0.8882176510304499},{"lat":51.55483115051075,"lng":-0.8897289103208497},{"lat":51.55298599239683,"lng":-0.8909601571843213},{"lat":51.55112365896876,"lng":-0.89204027969886},{"lat":51.54952637825085,"lng":-0.8928614894931973},{"lat":51.54824420674726,"lng":-0.8937254763141059},{"lat":51.547385841834945,"lng":-0.8944781931665354},{"lat":51.54657348016015,"lng":-0.8951035795978003},{"lat":51.54380576391394,"lng":-0.8969623604448961},{"lat":51.54322723520744,"lng":-0.8973548815650814},{"lat":51.542025345933304,"lng":-0.8983933265488038},{"lat":51.54074455004179,"lng":-0.8994083849620906},{"lat":51.539913590056386,"lng":-0.8997312323089245},{"lat":51.538183773257416,"lng":-0.8998486357707478},{"lat":51.53740722478354,"lng":-0.8992617755385485},{"lat":51.53755152166866,"lng":-0.901226435254086},{"lat":51.53709481922717,"lng":-0.9011869659248617},{"lat":51.536573062278606,"lng":-0.9009219754167795},{"lat":51.535479986308545,"lng":-0.9001408921715626},{"lat":51.535479749875115,"lng":-0.900115666450888},{"lat":51.534647723458406,"lng":-0.8986470897526724},{"lat":51.5339136265424,"lng":-0.8975546584784816},{"lat":51.53334300589885,"lng":-0.897114296122058},{"lat":51.53315042732757,"lng":-0.8967152670390649}
];

// Data service for water routes
export class RouteService {
  private routes: WaterRoute[] = [];

  constructor() {
    this.initializeMockRoutes();
  }

  private initializeMockRoutes(): void {
    // Venice, Henley, Charles River, Lake Bled, and River Thames routes from GPX data
    this.routes = [
      {
        id: '1',
        name: 'Venice Grand Canal',
        description: 'Authentic Venetian rowing route through historic canals. Parsed from actual GPS data recorded in Venice, Italy.',
        distance: 3.65, // Calculated from GPX data
        difficulty: 'moderate',
        location: 'Venice, Italy',
        coordinates: veniceCoordinates,
        elevationGain: 0, // Sea level route
        estimatedTime: Math.round((3.65 / 3.5) * 60), // ~63 minutes at average pace
        tags: ['canal', 'historic', 'scenic', 'italy', 'cultural', 'gpx-imported'],
        createdAt: new Date('2024-08-15'),
      },
      {
        id: '2',
        name: 'Henley Regatta Route',
        description: 'Famous Thames River rowing course, home of the prestigious Henley Royal Regatta. Parsed from actual GPS data recorded on the River Thames.',
        distance: 7.03, // Calculated from GPX data
        difficulty: 'hard',
        location: 'Henley-on-Thames, UK',
        coordinates: henleyCoordinates,
        elevationGain: 0, // River route
        estimatedTime: Math.round((7.03 / 3.5) * 60), // ~121 minutes at average pace
        tags: ['river', 'historic', 'racing', 'uk', 'thames', 'regatta', 'gpx-imported'],
        createdAt: new Date('2024-08-16'),
      },
      {
        id: '3',
        name: 'Charles River Boston',
        description: 'World-famous regatta course along Boston\'s Charles River. Home of the Head of the Charles Regatta, featuring the historic 11 km course from Boston University to Herter Park.',
        distance: 11.07, // Calculated from GPX data
        difficulty: 'hard',
        location: 'Boston, MA, USA',
        coordinates: charlesRiverCoordinates,
        elevationGain: 0, // River route
        estimatedTime: Math.round((11.07 / 3.5) * 60), // ~190 minutes at average pace
        tags: ['river', 'racing', 'boston', 'usa', 'regatta', 'charles', 'famous', 'competition', 'gpx-imported'],
        createdAt: new Date('2024-08-17'),
      },
      {
        id: '4',
        name: 'Lake Bled Circuit',
        description: 'Stunning alpine lake rowing course in Slovenia. Complete circuit of Lake Bled with views of medieval Bled Castle and the Julian Alps. Popular international competition venue.',
        distance: 6.24, // Calculated from GPX data
        difficulty: 'moderate',
        location: 'Bled, Slovenia',
        coordinates: lakeBledCoordinates,
        elevationGain: 0, // Lake route
        estimatedTime: Math.round((6.24 / 3.5) * 60), // ~107 minutes at average pace
        tags: ['lake', 'scenic', 'alpine', 'slovenia', 'europe', 'mountain', 'castle', 'competition', 'gpx-imported'],
        createdAt: new Date('2024-08-18'),
      },
      {
        id: '5',
        name: 'River Thames London',
        description: 'Epic rowing journey through the heart of London along the River Thames. Experience iconic landmarks from Putney to Greenwich, passing Westminster, Tower Bridge, and the Thames Barrier.',
        distance: 32.50, // Calculated from GPX data
        difficulty: 'hard',
        location: 'London, UK',
        coordinates: riverThamesCoordinates,
        elevationGain: 0, // River route
        estimatedTime: Math.round((32.50 / 3.5) * 60), // ~557 minutes at average pace
        tags: ['river', 'urban', 'london', 'uk', 'thames', 'landmarks', 'long-distance', 'gpx-imported'],
        createdAt: new Date('2024-08-19'),
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
