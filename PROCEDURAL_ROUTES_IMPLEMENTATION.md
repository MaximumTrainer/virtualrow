# Procedurally Generated Routes - Implementation Guide

## ✅ Completed (Phases 1-2)

### Phase 1: Geospatial Data Enrichment Infrastructure
The complete enrichment pipeline is ready:
- **RouteEnrichmentService** (`src/services/routeEnrichmentService.ts`)
  - OpenTopoData elevation API integration (batched 100 points per request)
  - OSM Overpass API integration for landscape classification
  - Water body type detection (river, canal, lake, stream)
  - 7-day cache in localStorage
  - Graceful error handling with fallback to default scenery
  - Comprehensive unit test coverage

- **OSM Tag Mapping**:
  - `landuse=forest` / `natural=wood` → Dense forest profile
  - `landuse=residential` → Residential (mixed trees + buildings)
  - `landuse=commercial` / `industrial` → Commercial (buildings, low vegetation)
  - `landuse=farmland` / `grass` / `meadow` → Farmland (sparse vegetation)
  - `natural=beach` / `sand` → Beach (sandy banks, palms/reeds)
  - `natural=wetland` → Wetland (reeds, low scrub)
  - No OSM data → Default fallback

### Phase 2: Data Models and Types
- **WaterRoute type extended** with optional `enrichment` metadata
- **RouteEnrichmentMetadata** type with water body type, bank width, flags
- **Dependency injection** wired through ServicesContext
- Backward compatible with existing routes

### Phase 3 (Partial): Geospatial Utilities
- **geoUtils.ts enhancements**:
  - `bearingBetweenLatLng()` - Calculate direction between coordinates (0-360°)
  - `bearingDelta()` - Calculate smallest angle between bearings (-180 to +180°)
  - `upsampleCoordinates()` - Ensure ≤10m resolution via cubic Hermite interpolation
  - `segmentRoute()` - Divide routes into distance-based chunks (default 50m)
  - **27 passing unit tests**

---

## 🚧 Remaining Work

### Phase 3: Data-Driven Scenery Generation

**Current State**: Scenery is generated with hardcoded procedural parameters in `src/components/rower3d/vegetationComponents.tsx`, `bankComponents.tsx`, etc.

**Required Changes**:

1. **Create Scenery Configuration System**
   ```typescript
   // src/components/rower3d/sceneryConfig.ts

   export interface SceneryProfileConfig {
     trees: {
       density: number; // trees per 100m
       species: string[]; // from theme tree species
       scaleRange: [number, number];
     };
     groundCover: {
       density: number;
       types: string[]; // reed, rock, grass, flower, debris
     };
     buildings: {
       probability: number; // 0-1
       heightRange: [number, number];
     };
   }

   export const SCENERY_PROFILES: Record<SceneryProfile, SceneryProfileConfig> = {
     'dense-forest': { ... },
     'residential': { ... },
     'commercial': { ... },
     'farmland': { ... },
     'beach': { ... },
     'wetland': { ... },
     'default': { ... }
   };
   ```

2. **Refactor VegetationComponents**
   - Replace hardcoded `const treeSpacing = 8` with profile-driven density
   - Accept `segments` prop with scenery profile per segment
   - Generate trees based on profile configuration
   - Implement gradual transitions (interpolate density/scale between segments)

3. **Update BankComponents**
   - Accept `bankWidth` prop from enrichment data
   - Use water body type to adjust bank geometry (steep for canals, gentle for lakes)
   - Vary bank material based on scenery profile (sandy for beach, muddy for wetland)

4. **Modify Rower3D Integration**
   ```typescript
   // In Rower3D.tsx
   const [routeEnrichment, setRouteEnrichment] = useState<RouteEnrichment | null>(null);
   const { routeEnrichmentService } = useServices();

   useEffect(() => {
     // Async enrichment on route load
     routeEnrichmentService.enrichRoute(route.id, route.coordinates)
       .then(setRouteEnrichment)
       .catch(() => setRouteEnrichment(null));
   }, [route.id]);

   // Pass enrichment to scenery components
   <VegetationComponents
     curve={curve}
     enrichment={routeEnrichment}
     theme={theme}
   />
   ```

### Phase 4: Route Curvature Accuracy

**Implementation**:

1. **Coordinate Upsampling in Curve Generation**
   ```typescript
   // src/components/rower3d/curve.ts
   import { upsampleCoordinates } from '../../utils/geoUtils';

   export function createRouteCurve(coordinates, sceneScale) {
     // Upsample to 10m resolution before creating spline
     const upsampled = upsampleCoordinates(coordinates, 10);
     const points = gpsToScenePoints(upsampled, sceneScale);
     return new THREE.CatmullRomCurve3(points);
   }
   ```

2. **Bearing-Based Camera Angle**
   ```typescript
   // In Rower3D.tsx camera follow logic
   import { bearingBetweenLatLng } from '../../utils/geoUtils';

   // Calculate bearing from current and next coordinate
   const coordIndex = Math.floor(progress * route.coordinates.length);
   if (coordIndex < route.coordinates.length - 1) {
     const curr = route.coordinates[coordIndex];
     const next = route.coordinates[coordIndex + 1];
     const bearing = bearingBetweenLatLng(curr.lat, curr.lng, next.lat, next.lng);

     // Apply bearing to camera rotation (adjust for Three.js coordinate system)
     camera.rotation.y = (bearing - 90) * Math.PI / 180;
   }
   ```

### Phase 5: Cosmetic Drag Modifier

**Implementation**:

1. **Bearing-Based Turn Detection**
   ```typescript
   // In usePhysicsEngine.ts or a new cosmetic effects hook
   import { bearingBetweenLatLng, bearingDelta, segmentRoute } from '../utils/geoUtils';

   function calculateTurnDragModifier(
     coordinates: Coordinate[],
     currentPositionM: number
   ): number {
     const segments = segmentRoute(coordinates, 50); // 50m segments
     // Find current segment
     // Calculate bearing between segments
     // If abs(bearingDelta) > 15°, return drag multiplier up to 1.05
     // Return 1.0 for straight sections
   }
   ```

2. **Visual Effect Application**
   ```typescript
   // Cosmetic effect ONLY - does not modify WASM physics
   // Apply to displayed speed or add subtle water turbulence visual
   const displaySpeed = physicsSpeed * turnDragModifier;
   ```

3. **Documentation**
   ```typescript
   /**
    * COSMETIC EFFECT: Calculates a visual drag modifier based on route curvature.
    * This is NOT part of the physics model and does NOT affect WASM engine calculations.
    * Sharp turns (>15°) add up to +5% visual drag, displayed as subtle speed variation.
    *
    * @returns Drag multiplier (1.0 for straight, up to 1.05 for sharp turns)
    */
   ```

### Phase 6: Testing and Integration

1. **Integration Tests**
   - Test route enrichment → scenery generation pipeline
   - Verify cache behavior (hit/miss, TTL)
   - Test API failure fallback (mock fetch to return errors)
   - Screenshot comparison tests (Playwright) for scenery differences

2. **Performance Tests**
   - Measure enrichment time for typical route (1000-5000 points)
   - Verify non-blocking behavior (scene loads before enrichment completes)
   - Test memory usage with large routes

3. **E2E Acceptance Criteria**
   - [ ] Import rownative.icu route → triggers enrichment (console logs visible)
   - [ ] Forest segment renders denser trees than farmland segment
   - [ ] Route curvature matches GPS at ≤10m resolution (visual inspection)
   - [ ] Canal renders narrower banks than river (use OSM data)
   - [ ] Second load of same route uses cache (no API requests)
   - [ ] API unavailable shows no error, loads default scenery
   - [ ] Physics tests unchanged (all 14 usePhysicsEngine tests pass)

---

## API Documentation

### OpenTopoData API
- Endpoint: `https://api.opentopodata.org/v1/srtm30m`
- Format: `?locations=lat1,lng1|lat2,lng2|...`
- Limit: 100 points per request
- Returns: `{ results: [{ elevation: number | null }, ...] }`

### OSM Overpass API
- Endpoint: `https://overpass-api.de/api/interpreter`
- Method: POST with Overpass QL query
- Query structure:
  ```
  [out:json][timeout:25];
  (
    way["landuse"](bbox);
    relation["landuse"](bbox);
    way["natural"](bbox);
    relation["natural"](bbox);
    way["waterway"](bbox);
    relation["waterway"](bbox);
    way["building"](bbox);
    relation["building"](bbox);
    way["leisure"](bbox);
    relation["leisure"](bbox);
  );
  out geom;
  ```
- Returns: `{ elements: [{ type, id, tags, geometry }, ...] }`

---

## File Map

### Core Services
- `src/services/routeEnrichmentService.ts` - Enrichment pipeline
- `src/__tests__/routeEnrichment.test.ts` - 42 unit tests

### Utilities
- `src/utils/geoUtils.ts` - Geospatial calculations
- `src/__tests__/geoUtils.test.ts` - 27 unit tests

### Types
- `src/types/index.ts` - WaterRoute + RouteEnrichmentMetadata

### Dependency Injection
- `src/ports/index.ts` - RouteEnrichmentPort
- `src/context/ServicesContext.tsx` - Service wiring

### 3D Rendering (Requires Modification)
- `src/components/Rower3D.tsx` - Main orchestrator
- `src/components/rower3d/vegetationComponents.tsx` - Trees, ground cover
- `src/components/rower3d/bankComponents.tsx` - Riverbanks
- `src/components/rower3d/curve.ts` - Route curve generation
- `src/components/rower3d/themeConfig.ts` - Theme definitions

### Physics (Requires Modification)
- `src/hooks/usePhysicsEngine.ts` - Boat physics

---

## Notes for Future Implementation

1. **Non-Blocking Enrichment**: The enrichment service is designed to be non-blocking. The 3D scene should load immediately with default scenery, then update progressively as enrichment data arrives via `useState` in Rower3D.

2. **Cache Strategy**: For authenticated users, enrichment data can be persisted to `routes.metadata` JSONB column in Postgres (depends on issue #37). Current implementation uses localStorage which works for both guest and auth users.

3. **Performance**: The OpenTopoData and Overpass APIs can be slow (1-5 seconds for typical routes). The caching layer is critical for user experience.

4. **WASM Physics**: The physics engine (`usePhysicsEngine`) MUST NOT be modified. The bearing-based drag modifier is purely cosmetic and should be applied to displayed values only, not to the physics calculations.

5. **Testing Strategy**: Use Playwright screenshot comparison tests to verify scenery differences. Mock the enrichment service in tests to control scenery profiles.

---

## Current Status: 341 Tests Passing ✅

The foundation is complete and fully tested. Integration with the 3D rendering system is the next step.
