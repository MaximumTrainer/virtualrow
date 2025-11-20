Playwright E2E + Simulator Integration

This folder contains a simple simulator server and Playwright tests to exercise the app with simulated PM5 and Heart Rate devices.

Install prerequisites:

```bash
# From project root
npm install
# Optionally install Playwright browsers
npx playwright install
```

Run the dev app in one terminal:

```bash
npm run dev
```

Start the simulator server (optional - the test will spawn it automatically if start:sim is run separately):

```bash
npm run start:sim
```

Run Playwright tests:

```bash
npm run test:e2e
```

Test details:
- The test harness injects a mock `navigator.bluetooth` implementation (see `playwright/mock-bluetooth.js`) that connects to the simulator WebSocket server and receives simulated PM5/HR DataView payloads.
- `playwright/simulators/sim-server.js` is a minimal WS+HTTP control server used to broadcast simulation messages.
- The tests cover basic flows: connecting PM5 & HR monitors, starting/ending workouts, and verifying average/max HR persistence.

Notes:
- This is a lightweight simulator for runtime testing only; it attempts to replicate the data structures expected by the app's BLE parsers.
- For CI environments, ensure Playwright browsers are installed via `npx playwright install`.
