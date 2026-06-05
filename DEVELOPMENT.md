# VirtualRow Development Guide

## Architecture Overview

VirtualRow is a React + TypeScript web application with Three.js 3D visualization that enables virtual rowing while connected to a Concept2 PM5 indoor rower via Bluetooth.

### High-Level Architecture

```
User Browser
    
React Components (UI Layer)
    
React Hooks & Context (State Management)
    
Service Layer (Business Logic)
 bluetoothService (PM5 Communication)
 heartRateBluetoothService (HR Monitor)
 routeService (Route Management)
 workoutService (Workout Tracking)
 workoutGeneratorService (Structured Workouts)
    
External APIs & Hardware
 Web Bluetooth API (PM5/HR Devices)
 Three.js (3D Visualization)
 Local Storage (Persistence)
```

## Technology Stack

- **React 19** + **TypeScript** - UI framework
- **Vite 7** - Build tool and dev server
- **Three.js** + **React Three Fiber** - 3D visualization
- **Web Bluetooth API** - PM5/HR device communication
- **Leaflet** - 2D map visualization
- **Vitest** - Unit testing
- **Playwright** - E2E testing

## Project Structure

```
src/
 components/
    Rower3D.tsx              # 3D rowing visualization (~2000 lines)
    RouteMap.tsx             # 2D route map overlay (Leaflet)
    RowingOverlay.tsx        # In-workout HUD (pace, power, HR, distance)
    BluetoothDevice.tsx      # PM5 connection UI
    HeartRateMonitor.tsx     # HR monitor connection
    HeartRateChart.tsx       # HR visualization
    HeartRateZonesChart.tsx  # HR zones display
    PM5Simulator.tsx         # PM5 hardware simulator
    WorkoutGenerator.tsx     # Structured workout UI
    WorkoutProgressDisplay.tsx
    MiniMetrics.tsx          # Compact metrics overlay
    PerformanceChart.tsx     # Performance graphs
    Canvas3DErrorBoundary.tsx
    routeLandmarks/
       LandmarkRenderer.tsx  # Landmark/scenery placement in 3D scene
 hooks/
    usePhysicsEngine.ts      # Physics engine interface
 services/
    bluetoothService.ts      # PM5 Bluetooth communication
    heartRateBluetoothService.ts # HR monitor service
    pm5SimulatorService.ts   # PM5 simulation
    routeService.ts          # Route data management
    workoutService.ts        # Workout session tracking
    workoutGeneratorService.ts # Structured workouts
 utils/
    geoUtils.ts              # Geographic calculations
    gpuUtils.ts              # WebGL/GPU detection
    routeGeometry.ts         # Route geometry helpers
 types/
    index.ts                 # Core TypeScript interfaces
    bluetooth.d.ts           # Web Bluetooth API types
 App.tsx                      # Root component; all application state lives here
 main.tsx                     # React entry point

playwright/
 tests/                       # E2E test specs
 simulators/                  # PM5/HR simulators (sim-server.cjs)
 fixtures/                    # Test fixtures
 utils/                       # Test utilities
```

## Key Components

### App.tsx — State Root

`App.tsx` owns all application state. There is no global state library; all data flows via props and callbacks:

- `currentView`: `'routes' | 'workouts' | 'workout' | 'history'`
- `sessionState`: `'idle' | 'active' | 'paused'`
- `selectedRoute`, `selectedWorkout`, `currentSession` — active session data
- `pm5Data`, `heartRateSamples` — live device streams
- `workoutHistory`, `workoutProgress` — persistence + workout tracking

A session auto-ends when `pm5Data.distance ≥ 99.5% of route.distance`. This auto-end is suppressed under the `window.__PLAYWRIGHT_TESTING` flag used by E2E tests.

### Rower3D Component

The main 3D visualization component (~2000 lines) using React Three Fiber:

- 3D boat with animated oars and rower
- Dynamic river/lake scenery generation
- Trees, vegetation, buildings with perspective scaling
- View corridor transparency (objects don't obstruct boat view)
- World rotation with speed limiting
- Route curve following based on PM5 pace data
- Gerstner GPU water shaders (4-train GLSL), Kelvin wake, blade foam
- CubeCamera reflections, ACES tone mapping, chromatic aberration, bloom, DoF

### RowingOverlay Component

Fullscreen HUD rendered on top of the 3D canvas during an active workout:

- Live metrics: pace (s/500m), power (W), distance (m), elapsed time, cadence (SPM), heart rate
- Workout progress when a structured workout is active (segment type, time remaining, compliance)
- Pause/Resume control

### Services

**bluetoothService.ts** - PM5 Bluetooth communication

- Web Bluetooth API connection to PM5 (Concept2 CSAFE BLE profile; Rowing Service UUID `ce060030-43e5-11e4-916c-0800200c9a66`)
- Real-time metric streaming (pace, distance, power, cadence)
- Event-based data emission

**heartRateBluetoothService.ts** - Heart rate monitor communication

- Standard BLE Heart Rate Service connection
- Real-time BPM streaming

**workoutGeneratorService.ts** - Structured workout management

- Pre-built workout templates
- intervals.icu import support
- Workout progress tracking
- Target compliance calculation

**workoutService.ts** - Session persistence

- Session CRUD via `localStorage`
- Personal best tracking per route (fastest average pace on completed sessions)
- Aggregate stats (total workouts, total distance, total time)
- GPX and FIT-JSON export generation

## Development Commands

```bash
# Start development server
npm run dev

# Type checking
npx tsc --noEmit

# Build production bundle
npm run build

# Run unit tests
npm test

# Run unit tests in watch mode
npm test -- --watch

# Run E2E tests
npm run test:e2e

# Start PM5/HR simulator (for E2E tests)
npm run start:sim

# Lint
npm run lint
```

## HD Asset Pipeline

### Boat Model

Place the production `.glb` sculling model at:

```
public/assets/boat/scull.glb
```

See `public/assets/boat/README.md` for the required node hierarchy and bounding box constraints.

### Environment Maps

Place equirectangular HDR environment maps at:

```
public/assets/env/<theme-name>.hdr
```

Currently using `@react-three/drei`'s built-in presets (`city`, `sunset`, `dawn`, `night`).


## Testing

### Unit Tests (Vitest)

Tests are in `src/__tests__/` directory:

- `rower3D.test.tsx` - 3D component logic tests
- `bluetoothService.test.ts` - PM5 service tests
- `heartRateBluetoothService.test.ts` - HR service tests
- `routeService.test.ts` - Route service tests
- `workoutGeneratorService.test.ts` - Workout service tests

### E2E Tests (Playwright)

Tests are in `playwright/tests/` directory:

- Route playback with simulated PM5/HR data
- Workout session persistence
- 3D visualization verification

The E2E tests use a WebSocket-based simulator (`playwright/simulators/sim-server.cjs`) that provides mock PM5 and heart rate data.

## PM5 Bluetooth Protocol

The PM5 uses standard Bluetooth LE with Concept2-specific services:

- **Rowing Service**: `ce060030-43e5-11e4-916c-0800200c9a66`
- **General Status**: Real-time rowing metrics
- **Additional Status**: Extended performance data

## Adding New Features

### Adding a New Route

Edit `src/services/routeService.ts` and add coordinates to the route data. Routes use GeoJSON-style coordinate arrays.

### Adding a New Workout Template

Edit `src/services/workoutGeneratorService.ts` and add a new workout definition with segments.

### Modifying 3D Scenery

Edit `src/components/Rower3D.tsx`:
- Tree generation: `treePositions` useMemo
- Vegetation: `vegetationPositions` useMemo
- Buildings: `buildingPositions` useMemo

## Environment Setup

Requires Node.js 20.19+ for best Vite compatibility.

```bash
# Install dependencies
npm install

# Install Playwright browsers (for E2E tests)
npx playwright install --with-deps
```

### Environment Variables

Create a `.env.local` file in the project root (not committed) with:

```
# OAuth client ID registered with intervals.icu for VirtualRow
VITE_INTERVALS_CLIENT_ID=your_client_id_here
```

> **Note**: Without `VITE_INTERVALS_CLIENT_ID`, the app starts normally but the "Sign in with intervals.icu" button will display an error when clicked. Guest mode and all rowing features remain fully functional.

### Registering an intervals.icu OAuth Application

To enable "Sign in with intervals.icu":

1. Log in to [intervals.icu](https://intervals.icu) and go to **Settings → API** (or [intervals.icu/settings/api](https://intervals.icu/settings/api))
2. Create a new OAuth application with:
   - **Redirect URIs** — add both:
     - `http://localhost:5173/` — local dev
     - `https://maximumtrainer.github.io/virtualrow/app/` — GitHub Pages production
3. Copy the **Client ID** that intervals.icu generates
4. Add it to `.env.local`:
   ```
   VITE_INTERVALS_CLIENT_ID=<your-client-id>
   ```
5. Restart the Vite dev server (required after changing `.env.local`)

For production deploys, add the client ID as a **GitHub Actions secret** named `INTERVALS_OAUTH_CLIENT_ID` in the repository settings — `deploy-pages.yml` already passes it to the build as `VITE_INTERVALS_CLIENT_ID`.

### intervals.icu OAuth Proxy

The OAuth token exchange and API calls go through a Cloudflare Workers CORS proxy at:

```
https://mt-intervals-proxy.intervals-login.workers.dev/proxy/<path>
```

The proxy forwards `/proxy/<path>?<query>` to `https://intervals.icu/<path>?<query>`.

**ALLOWED_ORIGINS** must include VirtualRow's domains to work. The proxy source is in the [MaximumTrainer_Redux repo](https://github.com/MaximumTrainer/MaximumTrainer_Redux/blob/master/workers/intervals-cors-proxy/worker.js). Update `ALLOWED_ORIGINS` to include:

```js
'http://localhost:5173',    // Vite default dev port
'http://127.0.0.1:5173',
'https://maximumtrainer.github.io',
```

Then redeploy: `cd workers/intervals-cors-proxy && npx wrangler deploy`.

### E2E Auth Tests

Auth E2E tests require GitHub Actions secrets (not local `.env.local`):

| Secret | Purpose |
|---|---|
| `INTERVALS_CLIENT_ID` | OAuth client ID for test environment |
| `INTERVALS_TEST_ATHLETE_ID` | Test account athlete ID |
| `INTERVALS_TEST_ACCESS_TOKEN` | Long-lived access token for the test account |

## Deployment

```bash
# Build for production
npm run build

# Output is in dist/ directory
# Deploy to any static hosting service
```

---

## GitHub Pages Landing Page

The project website is published to GitHub Pages from the `docs/` directory on every push to `main` via `.github/workflows/pages.yml`.

### Enabling GitHub Pages (one-time repo setup)

1. Go to **Settings → Pages** in the GitHub repository
2. Under **Source**, select **GitHub Actions**
3. Push any change to `main` to trigger the first deployment

The landing page will be live at:
```
https://<org>.github.io/virtualrow/
```

### Updating the landing page

Edit `docs/index.html` — it is a self-contained static file with no build step.

To replace the hero screenshot, overwrite `docs/screenshot-rower-3d.png` with a new capture.
The gameplay E2E test (`captures gameplay visuals for rowing model and graphics validation`)
produces labeled canvas screenshots in `playwright/playwright-report/` that can be used directly.

### Local preview

```bash
# Serve docs/ locally (Python)
python -m http.server 8080 --directory docs

# Or with npx serve
npx serve docs
```
