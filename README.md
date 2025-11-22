# 🚣 VirtualRow - Virtual Rowing on Water Routes

VirtualRow is a web-based fitness application that lets you row on virtual water routes around the world while connected to your Concept2 PM5 indoor rower via Bluetooth. It's inspired by Biketerra but tailored specifically for rowing on scenic water routes rather than cycling on roads.

## Features

### 🗺️ Custom Water Routes
- Browse a curated collection of scenic water routes (lakes, rivers, coastal areas)
- Filter routes by difficulty, distance, and location
- Real-time map visualization using OpenStreetMap and Leaflet
- Route information including distance, estimated time, elevation gain, and difficulty level
- Create custom water routes for your community

### 💪 Structured Workout Generator
- **Interval-based training workouts** similar to Auuki for cycling training, but designed for rowing
- Pre-built workout templates (pyramid intervals, steady state, etc.)
- **Import workouts from intervals.icu** - integrate with your existing training plans
- Real-time workout progress tracking with visual segment indicators
- Target zones for pace, power, and heart rate
- **Automatic pacing feedback** - visual indicators show when you're on/off target
- **Dynamic speed adjustment** in 3D view based on workout intensity zones
- Workout structure visualization with color-coded segments

### 🚣 Concept2 PM5 Bluetooth Integration
- Connect directly to your Concept2 PM5 monitor via Web Bluetooth API
- Uses the proven [pm5-base](https://github.com/ergarcade/pm5-base) library for robust PM5 protocol support
- Real-time performance metrics:
  - Pace (seconds per 500m)
  - Distance rowed
  - Elapsed time
  - Power output (watts)
  - Stroke rate (strokes per minute)
  - Heart rate (if available via ANT+)
  - Calories burned
- Connection persists across route changes and UI navigation
- **Adaptive workout control** - PM5 data used to track progress through structured workouts

### 📊 Workout Tracking
- Record complete workout sessions linked to specific routes
- Link sessions to structured workouts for detailed interval analysis
- Automatic split tracking (every 500m)
- Real-time performance graphs
- Detailed workout history
- Export workout data (CSV, JSON)

### 📈 Performance Analytics
- Aggregate statistics (total distance, workouts, time, calories)
- Personal best tracking per route
- Performance trends over time
- Heart rate zones analysis
- Workout compliance tracking (on/off target metrics)

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

# Build for production
npm run build

# Preview production build
npm run preview
```

The application will be available at `http://localhost:5173/` in development mode.

> Note: Vite requires Node 20.19+ for best compatibility. If you see a Vite compatibility warning, upgrade Node to 20.19 or later.

## Browser Compatibility

Web Bluetooth API support varies by browser:
- ✅ Chrome/Chromium 56+
- ✅ Edge 79+
- ✅ Opera 43+
- ✅ Samsung Internet 6+
- ⚠️ Firefox (experimental, requires flag)
- ❌ Safari (requires workaround via Native Bridge)

## Architecture

### Core Components

**RouteMap** (`src/components/RouteMap.tsx`)
- Interactive map visualization of water routes
- Leaflet-based mapping with multiple tile layers
- Route information overlay

**BluetoothDevice** (`src/components/BluetoothDevice.tsx`)
- PM5 device connection management
- Real-time metrics display
- Connection status indicator

### Services

**bluetoothService** (`src/services/bluetoothService.ts`)
- Web Bluetooth API wrapper for PM5 communication
- Data parsing and event emission
- Command protocol implementation

**routeService** (`src/services/routeService.ts`)
- Route management and CRUD operations
- Route filtering and search
- Distance calculation using Haversine formula

**workoutService** (`src/services/workoutService.ts`)
- Workout session lifecycle management
- Split tracking and statistics
- Data export functionality

### Type Definitions

**types/index.ts**
- Comprehensive TypeScript interfaces for all data models
- Route, Workout, PM5Data, and User Profile types

**types/bluetooth.d.ts**
- Web Bluetooth API type definitions
- Browser compatibility declarations

## Project Structure

```
src/
├── components/           # React components
│   ├── RouteMap.tsx     # Map visualization
│   ├── RouteMap.css
│   ├── BluetoothDevice.tsx
│   └── BluetoothDevice.css
├── services/            # Business logic
│   ├── bluetoothService.ts
│   ├── routeService.ts
│   └── workoutService.ts
├── types/              # TypeScript definitions
│   ├── index.ts
│   └── bluetooth.d.ts
├── App.tsx            # Main application
├── App.css
├── main.tsx           # React entry point
└── index.css          # Global styles
```

## Concept2 PM5 Integration

The PM5 Bluetooth integration uses the [pm5-base](https://github.com/ergarcade/pm5-base) library, which provides:
- Robust PM5 GATT protocol implementation
- Multiplexed data parsing for all PM5 characteristics
- Event-driven architecture for real-time data
- Automatic connection management and error recovery

**PM5 Services:**
- **Discovery Service**: `ce060000-43e5-11e4-916c-0800200c9a66`
- **Information Service**: `ce060010-43e5-11e4-916c-0800200c9a66`
- **Control Service**: `ce060020-43e5-11e4-916c-0800200c9a66`
- **Rowing Service**: `ce060030-43e5-11e4-916c-0800200c9a66`

**Data Characteristics:**
- General Status (0x31): Basic rowing metrics
- Additional Status (0x32): Extended performance data
- Stroke Data (0x35): Per-stroke analysis
- Multiplexed Information (0x80): Aggregated data stream

Data is received in real-time via BLE notifications, parsed by pm5-base, and emitted as structured events.

### Connection Persistence

The application maintains Bluetooth connections across:
- ✅ Route selection and navigation
- ✅ Workout start/stop cycles
- ✅ Tab switches (Routes → Workout → History)
- ✅ Component re-renders and state updates

Connections only terminate when:
- User explicitly disconnects
- PM5 device powers off
- Bluetooth signal is lost (range/interference)

## Available Routes

Included routes from real GPX data:
1. **Venice Grand Canal** - 3.65 km, Moderate - Historic Venetian canals
2. **Henley Regatta Route** - 7.03 km, Hard - Famous Thames River regatta course
3. **Charles River Boston** - 11.07 km, Hard - World-famous Head of the Charles course
4. **Lake Bled Circuit** - 6.24 km, Moderate - Stunning alpine lake in Slovenia

All routes parsed from actual GPS data recorded at these locations!

## Development

### Build Tools
- **Vite** - Fast bundler and dev server
- **React 18** - UI framework
- **TypeScript** - Type-safe development
- **Leaflet** - Map library
- **React-Leaflet** - React wrapper for Leaflet
- **pm5-base** - Concept2 PM5 Bluetooth protocol library

### Development Commands

```bash
# Start development server
npm run dev

# Type checking
npx tsc -b

# Build production bundle
npm run build

# Preview production build
npm run preview

# Lint configuration
npm run lint
```

## Testing

### Unit Tests

Run the unit test suite using Vitest:

```bash
# Run all unit tests
npm test

# Run tests in watch mode (during development)
npm test -- --watch

# Run tests with coverage
npm test -- --coverage
```

**Test Coverage:**
- ✅ 7 test suites, 20 tests
- Services: `bluetoothService`, `heartRateBluetoothService`, `routeService`, `workoutService`
- Components: `App`, `HeartRateChart`, `HeartRateMonitor`

### End-to-End Tests (Playwright)

Run E2E tests that simulate PM5 and heart rate devices:

```bash
# Install Playwright browsers (first time only)
npx playwright install --with-deps

# Run all tests (starts dev server and simulator automatically)
npx playwright test

# Run tests from playwright directory
cd playwright
npx playwright test

# Run tests with UI
npx playwright test --ui

# View test report
npx playwright show-report playwright-report
```

**E2E Test Scenarios:**
- ✅ Route playback with simulated PM5 and heart rate data
- ✅ Multiple sequential routes with different HR profiles
- ✅ 3D rowing visualization and animation
- ✅ Workout session persistence and metrics aggregation

### Running All Tests

To run the complete test suite:

```bash
# Run unit tests
npm test -- --run

# Run E2E tests
npx playwright test
```

**Note:** E2E tests automatically start the development server and simulator. No manual setup required.

## End-to-end (E2E) Tests

To run the Playwright end-to-end tests that exercise the PM5 and heart-rate simulator locally:

```bash
# Install dependencies
npm ci

# Install playwright browsers (also runable via npm run pretest:e2e)
npx playwright install --with-deps

# Start the simulator in a separate terminal
npm run start:sim

# Start the dev server in a separate terminal
npm run dev

# Run e2e tests
npm run test:e2e
```

If running in CI, see `/.github/workflows/playwright-e2e-clean.yml` for how the CI starts the simulator and dev server and runs the tests.

## 3D Rowing Experience

The app supports a 3D rowing view to make workout sessions more immersive. The 3D view is shown when you start a workout (during the active workout screen):
- A 3D scene is displayed at the center representing the rower moving forward along the selected route.
- The 'Map' remains as a small overlay in the bottom-right for navigation context.
- Heart rate and pace are shown in a compact overlay at the bottom-left.

How it works:
- The 3D view uses a minimal Three.js/React-Three-Fiber setup that generates a spline from the route coordinates and animates a boat along that spline.
- Pace from the PM5 (seconds/500m) is converted to m/s and drives the movement speed.

To run locally:
```bash
# Install dependencies including 3D libs
npm ci

# Start dev server
npm run dev

# Start simulator if you want to test without a physical device
npm run start:sim

# Open the app at http://localhost:5173 and start a workout
```

Development note: This initial 3D experience is intentionally simple; you can replace the boat mesh with a more advanced model, add water shaders or post-processing, and tune the camera/physics for a more cinematic experience.

## Using Structured Workouts

VirtualRow now includes a powerful workout generator that lets you follow structured interval training programs, similar to Auuki for cycling but designed specifically for rowing.

### Creating and Selecting Workouts

1. **Navigate to the Workouts tab** - Click the "💪 Workouts" tab in the sidebar
2. **Browse available workouts** - View pre-built workout templates including:
   - Pyramid Intervals (warmup → intervals → cooldown)
   - Steady State (consistent pace over distance)
3. **Import from intervals.icu** - Click "Import from intervals.icu" to bring in your existing training plans:
   - Enter your intervals.icu API key
   - Provide your athlete ID
   - Enter the workout ID you want to import
4. **Select a workout** - Click on any workout card to select it for your next session

### Starting a Structured Workout

1. **Select a route** - Choose any water route from the Routes tab
2. **Connect PM5** - Ensure your PM5 device is connected via Bluetooth
3. **Start workout** - Click "Start Workout" (the selected structured workout will be automatically applied)
4. **Follow the targets** - During your workout, you'll see:
   - Current segment type (warmup, work, rest, cooldown)
   - Target pace/power/heart rate zones
   - Real-time feedback on whether you're on target
   - Visual progress through the workout structure
   - Color-coded intensity zones

### Workout Progress Indicators

During a structured workout, the app displays:
- **Segment progress bar** - Shows completion of current interval
- **Target compliance** - Green (✓ On Target) or Orange (↑/↓ Too Fast/Slow)
- **Workout timeline** - Visual representation of all segments with current position
- **Deviation percentage** - How far off target you are (if applicable)
- **Segment targets** - Specific pace, power, and heart rate targets for each interval

### intervals.icu Integration

The intervals.icu integration allows you to:
- Import structured workouts from your training plans
- Use existing workout libraries
- Maintain consistency between cycling/running/rowing training
- Automatically parse workout steps with targets and intensities

To get your intervals.icu API key:
1. Log in to intervals.icu
2. Go to Settings → API
3. Generate a new API key
4. Copy your Athlete ID from your profile

### How PM5 Data Controls Workout Progress

The app uses real-time PM5 data to:
- **Track progress** through workout segments (time-based or distance-based)
- **Evaluate compliance** with target metrics (pace, power, heart rate)
- **Advance segments** automatically when targets are met
- **Provide feedback** via visual indicators (on/off target)
- **Adjust visualization** - 3D rowing speed reflects workout intensity zones

This creates a dynamic, responsive training experience where the app adapts to your actual performance in real-time.

## Performance Metrics

The app tracks:
- **Primary**: Pace, Distance, Time (core rowing metrics)
- **Secondary**: Power, Cadence, Heart Rate (optional sensors)
- **Calculated**: Average pace, splits, calories, zones

## Privacy & Data

- All data is stored locally in browser (IndexedDB/LocalStorage)
- No data is sent to external servers
- Workout history persists between sessions
- Export functionality for personal data backup

## Roadmap

- [x] ~~Interval training programs~~ **COMPLETED** - Structured workout generator with intervals.icu integration
- [ ] Multi-language support
- [ ] Leaderboards and social features
- [ ] Enhanced intervals.icu integration (two-way sync, automatic workout scheduling)
- [ ] ANT+ device support
- [ ] Real-time audio guidance on routes and workouts
- [ ] Mobile app (React Native)
- [ ] VR visualization support
- [ ] Customizable route creation tools
- [ ] Social workout sharing
- [ ] Workout builder UI for creating custom interval workouts
- [ ] TrainingPeaks integration

## Troubleshooting

### PM5 Won't Connect

#### Error: "Failed to execute 'requestDevice' on 'Bluetooth': Invalid Service name"

This error occurs when an invalid UUID format is used in Bluetooth service filters. Service UUIDs must be in full 128-bit format (e.g., `'00001800-0000-1000-8000-00805f9b34fb'`), not short format (e.g., `'1800'`).

**This has been fixed in the latest code.** If you're still seeing this error:

1. **Ensure you have the latest code**

   ```bash
   git pull origin main
   npm install
   npm run build
   ```

2. **Clear browser cache**
   - Clear local storage and site data for the app
   - Hard refresh the page (Ctrl+Shift+R or Cmd+Shift+R)

#### Error: "No Services matching UUID ce060000-43e5-11e4-916c-0800200c9a66 found in Device"

This error means the PM5 Bluetooth service isn't being detected. Try these steps in order:

1. **Power Cycle PM5**
   - Turn the PM5 monitor completely OFF
   - Wait 30 seconds
   - Turn it back ON
   - The display should show the usual splash screen

2. **Reset Bluetooth Pairing**
   - Go to your OS Bluetooth settings
   - Find "PM5" or "Rower" device
   - Forget/Unpair the device
   - Restart your computer (not just disconnect)
   - Return to the app and try connecting again

3. **Check Distance & Interference**
   - Move within 1-2 meters of the PM5 monitor
   - Move away from WiFi routers, microwaves, and other BLE devices
   - Try in a different location if possible

4. **Browser & OS Compatibility**
   - Ensure you're using a Bluetooth-enabled device (Windows 10+, macOS 10.12+, Linux with Bluetooth)
   - Try a different browser (Chrome/Chromium works best)
   - Disable VPN or proxy software temporarily

5. **Update Firmware**
   - Check if your PM5 monitor has the latest firmware installed
   - Visit Concept2 support site for firmware updates

#### Other Connection Issues

- **Ensure PM5 is powered on and nearby** (≤10m)
- **Check browser console** for detailed error messages
- **Verify browser supports Web Bluetooth** (Chrome/Chromium 56+, Edge 79+, Opera 43+)
- **Try resetting PM5 device** via the monitor's menu
- **Restart browser** and try again### Map Not Loading

- Check internet connection (tiles load from CDN)
- Verify Leaflet CSS is loaded
- Check browser console for script errors

### Performance Issues

- Close unnecessary browser tabs
- Clear browser cache
- Disable browser extensions
- Try a different browser

## Contributing

Contributions welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## License

MIT License - see LICENSE file for details

## Credits

- **Inspired by**: Biketerra
- **Concept2**: PM5 device specifications
- **Leaflet**: Map visualization
- **Web Bluetooth API**: Device connectivity

## Support

For issues, questions, or suggestions:

- Open an issue on GitHub
- Check existing documentation
- Review browser compatibility

---

Happy rowing! 🚣⛵ Get out on the water!

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```
