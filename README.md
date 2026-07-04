# VirtualRow — Row Anywhere on Real Water Routes

[![Deploy Landing Page](https://github.com/MaximumTrainer/virtualrow/actions/workflows/pages.yml/badge.svg)](https://github.com/MaximumTrainer/virtualrow/actions/workflows/pages.yml)
[![Playwright E2E Tests](https://github.com/MaximumTrainer/virtualrow/actions/workflows/playwright-e2e-clean.yml/badge.svg)](https://github.com/MaximumTrainer/virtualrow/actions/workflows/playwright-e2e-clean.yml)

**[🌐 Website](https://maximumtrainer.github.io/virtualrow/) · [📦 GitHub](https://github.com/MaximumTrainer/virtualrow)**

VirtualRow is a web-based fitness application that lets you row on virtual water routes while connected to your Concept2 PM5 indoor rower via Bluetooth. Experience immersive 3D rowing visualization from your home.

## Features

### Water Routes

VirtualRow now ships with one bundled demo route:

| Route | Location | Distance | Difficulty |
|---|---|---|---|
| Willowbrook River | Willowbrook Valley | 5.0 km | Easy |

To row real-world courses, search and import them directly from **rownative.icu** in the route selector.

### Immersive 3D Visualization

- Real-time 3D rowing scene with boat, rower, and animated oars
- Dynamic scenery: trees, vegetation, buildings along riverbanks
- Perspective scaling based on distance from rower
- View corridor management - objects become transparent to never obstruct the boat
- Smooth camera following with limited rotation speed
- Cinematic post-processing: ACES tone mapping, chromatic aberration, depth of field, bloom
- Kelvin wake and blade foam particle effects
- CubeCamera environment reflections on water surface

### Concept2 PM5 Bluetooth Integration

- Connect directly to your Concept2 PM5 monitor via Web Bluetooth API (Concept2 CSAFE BLE profile)
- Real-time performance metrics: pace, distance, time, power, stroke rate, calories
- Connection persists across route changes and UI navigation
- Built-in PM5 Simulator for testing and demo without physical hardware

### Heart Rate Monitoring

- Connect heart rate monitors via Bluetooth (standard HR service)
- Real-time BPM display with chart visualization
- Average and max HR tracking per workout

## Getting Started

See **First-Time Setup** below under Testing, or for quick start:

```bash
git clone <repository-url>
cd virtualrow
npm install
npm run dev          # → http://localhost:5173
```

### Browser Compatibility

- Chrome/Chromium 56+ (recommended)
- Edge 79+
- Opera 43+
- Firefox (experimental, requires flag)

## Project Structure

```
src/
 components/
    Rower3D.tsx                    # 3D rowing visualization (~2000 lines)
    RouteMap.tsx                   # 2D route map (Leaflet)
    RowingOverlay.tsx              # In-workout HUD with live metrics
    BluetoothDevice.tsx            # PM5 connection UI
    HeartRateMonitor.tsx           # HR monitor connection
    PM5Simulator.tsx               # PM5 hardware simulator
    MiniMetrics.tsx                # Compact metrics overlay
    PerformanceChart.tsx           # Post-session performance graphs
    HeartRateChart.tsx             # Live HR chart
    Canvas3DErrorBoundary.tsx      # WebGL error fallback
    routeLandmarks/
       LandmarkRenderer.tsx        # Route landmark placement in 3D scene
 hooks/
    usePhysicsEngine.ts            # Physics engine interface
 services/
    bluetoothService.ts            # PM5 BLE communication
    heartRateBluetoothService.ts   # HR monitor BLE service
    pm5SimulatorService.ts         # PM5 simulation
    routeService.ts                # Route data + rownative route import
    workoutService.ts              # Session tracking + localStorage persistence
 utils/
    geoUtils.ts                    # Geographic calculations
    gpuUtils.ts                    # WebGL/GPU detection
    routeGeometry.ts               # Route spline geometry helpers
 types/
    index.ts                       # Core TypeScript interfaces
    bluetooth.d.ts                 # Web Bluetooth API types
 App.tsx                           # Root component; all application state lives here
 main.tsx                          # React entry point

playwright/
 tests/                            # E2E test specs
 simulators/                       # WebSocket PM5/HR sim server (sim-server.cjs)
 fixtures/                         # Test fixtures
 utils/                            # Test utilities

docs/
 index.html                        # GitHub Pages landing page (no build step)
```

## Testing

```bash
# Run unit tests (Vitest)
npm test

# Run unit tests in watch mode
npm test -- --watch

# Run E2E tests (Playwright)
npm run test:e2e

# Start PM5/HR WebSocket simulator (required for E2E)
npm run start:sim
```

Unit tests are in `src/__tests__/`. E2E tests are in `playwright/tests/` and use a WebSocket simulator at `playwright/simulators/sim-server.cjs`.

## First-Time Setup

```bash
git clone <repository-url>
cd virtualrow
npm install

npm run dev
# → http://localhost:5173
```

### 3D Environment Asset Kit

Generate the reusable environment GLB kit (riverbed, water surface, riverbanks, trees, buildings, bridge, dock, buoy):

```bash
npm run generate:environment-assets
```

Output file:

- `public/models/virtualrow-environment.glb`

## Troubleshooting

See [PM5_TROUBLESHOOTING.md](./PM5_TROUBLESHOOTING.md) for PM5 connection issues.

## Development

See [DEVELOPMENT.md](./DEVELOPMENT.md) for detailed development information.

## License

MIT
