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
    Rower3D.tsx              # 3D rowing visualization (2000+ lines)
    RouteMap.tsx             # 2D route map overlay
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
 App.tsx                      # Main application
 main.tsx                     # React entry point

playwright/
 tests/                       # E2E test specs
 simulators/                  # PM5/HR simulators
 fixtures/                    # Test fixtures
 utils/                       # Test utilities
```

## Key Components

### Rower3D Component

The main 3D visualization component (~2000 lines) using React Three Fiber:

- 3D boat with animated oars and rower
- Dynamic river/lake scenery generation
- Trees, vegetation, buildings with perspective scaling
- View corridor transparency (objects don't obstruct boat view)
- World rotation with speed limiting
- Route curve following based on PM5 pace data

### Services

**bluetoothService.ts** - PM5 Bluetooth communication

- Web Bluetooth API connection to PM5
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

The E2E tests use a WebSocket-based simulator (`playwright/simulators/sim-server.js`) that provides mock PM5 and heart rate data.

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

## Deployment

```bash
# Build for production
npm run build

# Output is in dist/ directory
# Deploy to any static hosting service
```
