# VirtualRow Development Guide

## Project Overview

VirtualRow is a React + TypeScript web application that enables virtual rowing on water routes while connected to a Concept2 PM5 indoor rower via Bluetooth Web API.

## Architecture Overview

### High-Level Flow

```
User Browser
    ↓
React Components (UI Layer)
    ↓
React Hooks & Context (State Management)
    ↓
Service Layer (Business Logic)
    ├── bluetoothService (PM5 Communication)
    ├── routeService (Route Management)
    └── workoutService (Workout Tracking)
    ↓
External APIs & Hardware
    ├── Web Bluetooth API (PM5 Device)
    ├── Leaflet/OpenStreetMap (Maps)
    └── Local Storage (Persistence)
```

## Service Layer Architecture

### bluetoothService.ts

Handles all PM5 communication via Web Bluetooth API using the [pm5-base](https://github.com/ergarcade/pm5-base) library.

**Key Methods:**
```typescript
connect(): Promise<boolean>           // Establish BLE connection via pm5-base
disconnect(): Promise<void>           // Close connection
sendCommand(command: string): Promise<void>
getPM5Data(): PM5Data               // Get latest metrics
isConnected(): boolean               // Check connection status (queries pm5Wrapper)
```

**Event Emitters:**
```typescript
on('connected', data)    // Fired on successful connection
on('disconnected')       // Fired on disconnect (device or user-initiated)
on('data', pm5Data)      // Fired on new metric data
on('error', error)       // Fired on errors
```

**Architecture:**
- Uses `pm5-base` PM5 class as wrapper for Web Bluetooth operations
- Registers event listeners for: `additional-status`, `general-status`, `multiplexed-information`, `disconnect`
- Maps pm5-base event data to `PM5Data` interface:
  - `strokeRate` → `cadence`
  - `currentPace`/`averagePace` → `pace`
  - `averagePower` → `power`
  - Direct mapping: `elapsedTime`, `distance`, `heartRate`
- Connection state persists across component lifecycle (no disconnect on unmount)
- Proper event listener cleanup via `off()` method

### routeService.ts

Manages water route data and operations.

**Key Methods:**
```typescript
getAllRoutes(): WaterRoute[]
getRouteById(id: string): WaterRoute
searchRoutes(query: string): WaterRoute[]
filterRoutesByDifficulty(difficulty: string): WaterRoute[]
filterRoutesByDistance(min: number, max: number): WaterRoute[]
createRoute(data: RouteFormData): WaterRoute
updateRoute(id: string, data: Partial<RouteFormData>): WaterRoute
deleteRoute(id: string): boolean
```

**Route Data Structure:**
```typescript
interface WaterRoute {
  id: string
  name: string
  description: string
  distance: number            // in km
  difficulty: 'easy' | 'moderate' | 'hard'
  location: string
  coordinates: Coordinate[]   // lat/lng pairs
  elevationGain: number
  estimatedTime: number      // in minutes
  imageUrl?: string
  tags: string[]
  createdAt: Date
  userRating?: number
}
```

**Distance Calculation:**
Uses Haversine formula to calculate great-circle distance between coordinates.

### workoutService.ts

Manages workout session lifecycle and tracking.

**Key Methods:**
```typescript
startSession(routeId: string, routeName: string): WorkoutSession
endSession(): WorkoutSession | null
updateSessionWithPM5Data(data: PM5Data): void
getCurrentSession(): WorkoutSession | null
getSessionById(id: string): WorkoutSession
getAllSessions(): WorkoutSession[]
getSessionsByRoute(routeId: string): WorkoutSession[]
getRecentSessions(days: number): WorkoutSession[]
getStats(): Statistics
exportSessionsAsJSON(): string
exportSessionsAsCSV(): string
```

**Session Data Structure:**
```typescript
interface WorkoutSession {
  id: string
  routeId: string
  routeName: string
  startTime: Date
  endTime?: Date
  duration: number           // in seconds
  distance: number          // in meters
  averagePace: number       // s/500m
  calories: number
  heartRate?: {
    current: number
    average: number
    max: number
  }
  splits: Split[]           // 500m segments
  isActive: boolean
}
```

## Component Architecture

### RouteMap Component

**Props:**
```typescript
interface RouteMapProps {
  route: WaterRoute
  onRouteSelected?: (route: WaterRoute) => void
  highlightMode?: boolean
}
```

**Features:**
- Leaflet map with zoom/pan controls
- Route polyline visualization
- Start/end markers
- Info overlay with route details
- Multiple tile layers (satellite + terrain)

**Sub-Components:**
- `RoutePolyline`: Renders route path and markers

### BluetoothDevice Component

**Props:**
```typescript
interface BluetoothDeviceProps {
  onConnected?: (deviceName: string) => void
  onDisconnected?: () => void
  onDataReceived?: (data: PM5Data) => void
  onError?: (error: string) => void
}
```

**Features:**
- Connection button with loading state
- Real-time metrics grid
- Connection status indicator
- Error message display
- Auto-refresh on data

### Main App Component

**State Management:**
```typescript
const [currentView, setCurrentView] = useState<'routes' | 'workout' | 'history'>()
const [selectedRoute, setSelectedRoute] = useState<WaterRoute | null>()
const [isWorkoutActive, setIsWorkoutActive] = useState(false)
const [currentSession, setCurrentSession] = useState<WorkoutSession | null>()
const [pm5Connected, setPM5Connected] = useState(false)
const [pm5Data, setPM5Data] = useState<PM5Data | null>()
const [workoutHistory, setWorkoutHistory] = useState<WorkoutSession[]>()
```

**Main Handlers:**
```typescript
handleRouteSelect(route: WaterRoute): void
handleStartWorkout(): void
handleEndWorkout(): void
handlePM5Data(data: PM5Data): void
handlePM5Connected(): void
handlePM5Disconnected(): void
```

## Type System

### Core Types (types/index.ts)

All major interfaces are defined here:
- `Coordinate`: Lat/lng pair
- `WaterRoute`: Route definition
- `WorkoutSession`: Workout data
- `PM5Data`: Real-time metrics
- `Split`: 500m segment data
- `BluetoothDeviceState`: Connection status
- `UserProfile`: User preferences

### Bluetooth Types (types/bluetooth.d.ts)

Complete Web Bluetooth API type definitions:
- `Navigator.bluetooth`
- `BluetoothDevice`
- `BluetoothRemoteGATTServer`
- `BluetoothRemoteGATTCharacteristic`
- Service/characteristic UUIDs

## Styling System

### CSS Structure

**Global** (index.css)
- Root variables
- Base element styles
- Utility classes

**App** (App.css)
- Layout grid
- View-specific styles
- Responsive breakpoints

**Components**
- Scoped component styles
- CSS modules pattern
- Animation definitions

### Design System

**Colors:**
- Primary: `#667eea` (Purple-Blue)
- Secondary: `#764ba2` (Deep Purple)
- Success: `#10b981` (Green)
- Error: `#ef4444` (Red)
- Neutral: `#6b7280` (Gray)

**Spacing:**
- Base unit: 4px (Tailwind-like scale)
- Padding: 8px, 12px, 16px, 24px
- Gaps: 8px, 12px, 16px

**Typography:**
- Font Family: System fonts (-apple-system, BlinkMacSystemFont, 'Segoe UI', etc.)
- Scale: 12px, 13px, 14px, 16px, 18px, 20px, 24px, 28px

## PM5 Bluetooth Protocol

### pm5-base Library Integration

The application uses the [pm5-base](https://github.com/ergarcade/pm5-base) library which handles:
- Complete PM5 GATT protocol implementation
- Service and characteristic discovery
- Multiplexed data parsing
- Connection lifecycle management

### Connection Flow (via pm5-base)

```
1. User clicks "Connect PM5"
2. BluetoothService.connect() called
3. Dynamically imports pm5-base.js
4. Instantiates PM5 class with callbacks:
   - cb_connecting: emits 'connecting' event
   - cb_connected: emits 'connected' event
   - cb_disconnected: calls handleDisconnect()
   - cb_message: calls handlePM5Message()
5. Calls pm5Wrapper.doConnect()
6. pm5-base internally:
   - Requests Bluetooth device (filters for discovery service)
   - Connects to GATT server
   - Registers gattserverdisconnected listener
   - Sets up characteristic value listeners
7. Registers addEventListener for:
   - 'additional-status'
   - 'general-status'
   - 'multiplexed-information'
   - 'disconnect'
8. pm5-base starts notifications and parses data
9. Events dispatched with parsed data objects
10. bluetoothService maps to PM5Data interface
```

### PM5 Services & Characteristics

**Services:**
```typescript
const services = {
  discovery: { id: 'ce060000-43e5-11e4-916c-0800200c9a66' },
  information: { id: 'ce060010-43e5-11e4-916c-0800200c9a66' },
  control: { id: 'ce060020-43e5-11e4-916c-0800200c9a66' },
  rowing: { id: 'ce060030-43e5-11e4-916c-0800200c9a66' }
}
```

**Key Characteristics:**
- `0x31`: General Status (basic metrics)
- `0x32`: Additional Status (extended data)
- `0x35`: Stroke Data (per-stroke analysis)
- `0x80`: Multiplexed Information (combined stream)

### Data Mapping

pm5-base provides parsed event objects. bluetoothService maps them to PM5Data:

```typescript
// pm5-base event data → PM5Data interface
{
  strokeRate → cadence,
  currentPace/averagePace → pace,
  averagePower → power,
  elapsedTime → elapsedTime,
  distance → distance,
  heartRate → heartRate
}
```

### Connection Persistence

**Implementation Details:**
- BluetoothDevice component no longer disconnects on unmount
- Event listeners cleaned up via `off()` but connection maintained
- Callback functions wrapped in `useCallback` to prevent re-renders
- PM5 wrapper persists in bluetoothService singleton
- Disconnect only on:
  - User action (disconnect button)
  - Device power off
  - GATT server disconnect event

## Development Workflow

### Adding a New Feature

1. **Define Types** (types/index.ts)
   - Add TypeScript interfaces
   - Document all fields

2. **Create Service** (services/*.ts)
   - Implement business logic
   - Handle data transformations
   - Emit events for UI

3. **Build Component** (components/*.tsx)
   - Create React component
   - Add TypeScript props
   - Connect to services
   - Add styling (CSS)

4. **Integrate to App** (App.tsx)
   - Import component
   - Add state management
   - Connect event handlers
   - Add navigation if needed

5. **Test**
   - Manual browser testing
   - TypeScript compilation check
   - Responsive design verification

### Adding a New Route

Edit `src/services/routeService.ts`:

```typescript
private initializeMockRoutes(): void {
  this.routes = [
    {
      id: 'unique-id',
      name: 'Route Name',
      description: 'Description',
      distance: 10.5,
      difficulty: 'moderate',
      location: 'City, Country',
      coordinates: [
        { lat: 40.7128, lng: -74.0060 },
        { lat: 40.7580, lng: -73.9855 },
      ],
      elevationGain: 100,
      estimatedTime: 60,
      tags: ['tag1', 'tag2'],
      createdAt: new Date(),
    },
    // ...
  ]
}
```

### Extending PM5 Data Parsing

In `bluetoothService.ts`, modify `parseRowerData()`:

```typescript
private parseRowerData(value: DataView): Partial<PM5Data> {
  const data: Partial<PM5Data> = {}
  
  // Add your custom parsing logic
  if (value.byteLength >= YOUR_SIZE) {
    data.customMetric = value.getUint16(OFFSET, true)
  }
  
  return data
}
```

## Building & Deployment

### Development
```bash
npm run dev
```
- Hot Module Replacement (HMR) enabled
- Source maps for debugging
- Full error messages

### Production Build
```bash
npm run build
```
- Minified and optimized
- Source maps stripped
- Tree-shaking applied
- Output in `/dist`

### Performance Optimization

**Current:**
- Bundle size: ~373 KB (112 KB gzip)
- Initial load: <1s
- Real-time updates: <100ms

**Optimization Opportunities:**
- Code splitting (lazy load views)
- Service workers (offline support)
- Image optimization
- Route-based lazy loading

## Testing Strategy

### Unit Tests (Vitest)

The project uses [Vitest](https://vitest.dev/) for unit testing.

**Running Tests:**
```bash
# Run all tests
npm test

# Run with coverage
npm test -- --coverage

# Watch mode for development
npm test -- --watch

# Run specific test file
npm test -- bluetoothService.test.ts
```

**Test Structure:**
```
src/__tests__/
├── app.test.tsx                      # App component rendering
├── bluetoothService.test.ts          # PM5 service with mocked pm5-base
├── heartRateBluetoothService.test.ts # Heart rate service
├── heartRateChart.test.tsx           # Chart component
├── heartRateMonitor.test.tsx         # Monitor component
├── routeService.test.ts              # Route management
└── workoutService.hr.test.ts         # Workout tracking
```

**Mocking Strategy:**
- `pm5-base` library is mocked via `vi.mock()` to simulate PM5 device
- Mock implements: `doConnect()`, `doDisconnect()`, `connected()`, `addEventListener()`, `writeTransmit()`
- Navigator.bluetooth is mocked for service tests
- Component tests use `@testing-library/react`

**Test Coverage:**
- ✅ 19 tests across 7 test suites
- Services: Bluetooth (PM5 + HR), routes, workouts
- Components: App, charts, monitors
- All tests passing

### End-to-End Tests (Playwright)

E2E tests use [Playwright](https://playwright.dev/) with custom PM5 and heart rate simulators.

**Running E2E Tests:**
```bash
# Install Playwright browsers (first time)
npx playwright install --with-deps

# Run all E2E tests (auto-starts dev server + simulator)
npx playwright test

# Run from playwright directory
cd playwright
npx playwright test

# Run with UI for debugging
npx playwright test --ui

# Run specific test
npx playwright test routePlayback.spec.ts

# View last test report
npx playwright show-report playwright-report
```

**Test Scenarios:**
1. **Single Route Playback**
   - Connects simulated PM5 and heart rate devices
   - Starts workout on Venice route
   - Validates metrics update in real-time
   - Checks 3D rowing animation responds to pace
   - Verifies heart rate aggregation (avg/max)

2. **Multiple Sequential Routes**
   - Tests workout flow across different routes
   - Validates different heart rate profiles
   - Checks session persistence
   - Verifies metrics reset between routes

**Simulator Architecture:**
- Mock Bluetooth API (`playwright/mock-bluetooth.js`)
- WebSocket server for data streaming (`playwright/simulators/sim-server.js`)
- HTTP control API for test orchestration
- Compatible with pm5-base library (returns `this` from `startNotifications`)

**Test Configuration:**
```typescript
// playwright/playwright.config.ts
export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.ts',  // Only run .spec.ts files
  use: {
    baseURL: 'http://localhost:5173',
    headless: true,
    launchOptions: {
      args: ['--enable-unsafe-webgl', '--use-gl=swiftshader']
    }
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: false
  }
})
```

### Manual Testing Checklist

- [ ] Route selection works
- [ ] Map loads and zooms correctly
- [ ] PM5 connects via Bluetooth (real hardware)
- [ ] Connection persists across tab navigation
- [ ] Real-time metrics update during rowing
- [ ] Workout start/end cycle complete
- [ ] History displays past workouts
- [ ] Stats calculations are correct
- [ ] 3D rowing view animates correctly
- [ ] Responsive on mobile/tablet
- [ ] No console errors
- [ ] Disconnect/reconnect recovery works

## Browser DevTools Tips

### Bluetooth Debugging
```javascript
// In browser console
navigator.bluetooth.getDevices().then(devices => {
  console.log('Available devices:', devices)
})
```

### Performance Profiling
1. Open DevTools (F12)
2. Go to Performance tab
3. Record interaction
4. Analyze flame graph
5. Check for bottlenecks

### Network Inspection
- Check map tile loading (Network tab)
- Monitor WebSocket-like Bluetooth communication
- Verify API calls (future backend)

## Common Issues & Solutions

### State Not Updating
- Check React DevTools extension
- Verify state setter called correctly
- Look for stale closures in useEffect
- Check component re-render count

### Map Not Rendering
- Verify Leaflet CSS imported
- Check console for 404 errors
- Ensure lat/lng are valid numbers
- Test with different coordinates

### Bluetooth Connection Issues
- Check GATT service UUID matches
- Verify characteristic UUIDs
- Look for permission errors in console
- Test with Chrome DevTools Bluetooth Simulator

### Performance Degradation
- Profile with DevTools
- Check for memory leaks
- Monitor event listener cleanup
- Profile Bluetooth event frequency

## Code Style Guidelines

### TypeScript
- Use `type` for unions and types
- Use `interface` for object shapes
- Enable strict mode
- No `any` types without justification
- Full type annotations on functions

### React
- Functional components with hooks
- Props destructuring in parameters
- Single responsibility principle
- Memoization for expensive components
- Proper dependency arrays

### Naming Conventions
- Services: `camelCaseService`
- Components: `PascalCase`
- Variables: `camelCase`
- Constants: `UPPER_SNAKE_CASE`
- Private methods: `_camelCase` or `#camelCase`

## Resources & References

### Web Bluetooth API
- [MDN Web Bluetooth](https://developer.mozilla.org/en-US/docs/Web/API/Web_Bluetooth_API)
- [GATT Specifications](https://www.bluetooth.com/specifications/gatt/)

### Concept2 PM5
- [PM5 Specs](https://www.concept2.com/pm5-monitor)
- [BLE Protocol](https://www.concept2.com/us/en/bluetooth)

### Libraries
- [Leaflet.js](https://leafletjs.com/)
- [React](https://react.dev/)
- [Vite](https://vitejs.dev/)
- [TypeScript](https://www.typescriptlang.org/)

### Deployment Options
- Vercel (recommended for Vite)
- Netlify
- GitHub Pages
- AWS S3 + CloudFront
- Docker container

---

Happy coding! 🚣💻
