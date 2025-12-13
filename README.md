# VirtualRow - Virtual Rowing on Water Routes

VirtualRow is a web-based fitness application that lets you row on virtual water routes while connected to your Concept2 PM5 indoor rower via Bluetooth. Experience immersive 3D rowing visualization from your home.

## Features

### Water Routes

- Scenic water routes with real-time 3D visualization using Three.js/React Three Fiber
- Willowbrook River - A ~5km meandering river route with varied scenery
- Support for importing custom GPX and GeoJSON routes

### Immersive 3D Visualization

- Real-time 3D rowing scene with boat, rower, and animated oars
- Dynamic scenery: trees, vegetation, buildings along riverbanks
- Perspective scaling based on distance from rower
- View corridor management - objects become transparent to never obstruct the boat
- Smooth camera following with limited rotation speed

### Structured Workout Generator

- Interval-based training workouts designed for rowing
- Pre-built workout templates (pyramid intervals, steady state, etc.)
- Import workouts from intervals.icu - integrate with your existing training plans
- Real-time workout progress tracking with visual segment indicators
- Target zones for pace, power, and heart rate
- Automatic pacing feedback - visual indicators show when you're on/off target

### Concept2 PM5 Bluetooth Integration

- Connect directly to your Concept2 PM5 monitor via Web Bluetooth API
- Real-time performance metrics: pace, distance, time, power, stroke rate, calories
- Connection persists across route changes and UI navigation
- PM5 Simulator available for testing without hardware

### Heart Rate Monitoring

- Connect heart rate monitors via Bluetooth (standard HR service)
- Real-time BPM display with chart visualization
- Heart rate zone tracking and analysis
- Average and max HR tracking per workout

## Getting Started

### Installation

```bash
# Clone the repository
git clone <repository-url>
cd virtualrow

# Install dependencies
npm install

# Start development server
npm run dev
```

The application will be available at http://localhost:5173/

### Browser Compatibility

- Chrome/Chromium 56+ (recommended)
- Edge 79+
- Opera 43+
- Firefox (experimental, requires flag)

## Project Structure

```
src/
 components/
    Rower3D.tsx          # 3D rowing visualization
    RouteMap.tsx         # 2D route map overlay
    BluetoothDevice.tsx  # PM5 connection UI
    HeartRateMonitor.tsx # HR monitor connection
    PM5Simulator.tsx     # PM5 hardware simulator
    WorkoutGenerator.tsx # Structured workout UI
    WorkoutProgressDisplay.tsx
 services/
    bluetoothService.ts  # PM5 Bluetooth communication
    heartRateBluetoothService.ts
    routeService.ts
    workoutService.ts
    workoutGeneratorService.ts
 utils/
    geoUtils.ts
    routeGeometry.ts
 types/
```

## Testing

```bash
# Run unit tests
npm test

# Run E2E tests
npm run test:e2e
```

## Troubleshooting

See [PM5_TROUBLESHOOTING.md](./PM5_TROUBLESHOOTING.md) for PM5 connection issues.

## Development

See [DEVELOPMENT.md](./DEVELOPMENT.md) for detailed development information.

## License

MIT
