Playwright E2E + Simulator Integration

This folder contains a simple simulator server and Playwright tests to exercise the app with simulated PM5 and Heart Rate devices.

## Test Evidence & Screenshot Capture

The Playwright tests have been enhanced with automatic screenshot capture and error highlighting functionality to provide comprehensive test evidence.

### Key Features

1. **Automatic Screenshot Capture** - Screenshots are captured at key points throughout test execution
2. **Error Highlighting** - Failed assertions automatically highlight problematic elements with red borders and error overlays
3. **Element Annotation** - Tests can annotate elements with labels to document what's being tested
4. **Comprehensive Evidence** - Both passing and failing tests generate screenshot evidence

For detailed documentation on using the screenshot evidence features, see the "Screenshot Evidence" section below.

## Setup and Running Tests

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

---

## Screenshot Evidence Features

### Overview

The Playwright tests automatically capture screenshots as test evidence, including error highlighting when tests fail. This provides comprehensive visual documentation of test execution.

### Using Screenshot Helper Functions

Import the helper functions in your test file:

```typescript
import { 
  captureTestEvidence, 
  captureErrorEvidence, 
  highlightElement, 
  annotateElement, 
  clearAnnotations 
} from '../utils/screenshot-helper';
```

### Basic Usage

**Capturing Test Evidence:**
```typescript
// Basic screenshot with description
await captureTestEvidence(page, testInfo, 'after-login');

// Screenshot with element annotation
await annotateElement(page, '.login-button', 'Login Button', 'bottom');
await captureTestEvidence(page, testInfo, 'annotated-login-screen');
await clearAnnotations(page);
```

**Capturing Error Evidence:**
```typescript
try {
  await page.click('.submit-button');
} catch (error) {
  // Capture error with highlighted element
  await captureErrorEvidence(
    page, 
    testInfo, 
    'Button click failed', 
    '.submit-button'
  );
  throw error;
}
```

**Highlighting Elements:**
```typescript
// Highlight in green to show success
await highlightElement(page, '.success-message', 'green');
await captureTestEvidence(page, testInfo, 'operation-successful');

// Highlight in red to show error
await highlightElement(page, '.error-message', 'red');
await captureTestEvidence(page, testInfo, 'operation-failed');
```

### Configuration

The Playwright configuration has been updated to capture screenshots for all tests:

```typescript
screenshot: 'on',  // Captures screenshots for all tests
```

### Screenshot Naming Convention

- Regular evidence: `{description}-{timestamp}.png`
- Error evidence: `error-{description}-{timestamp}.png`
- Numbered screenshots: Use prefixes like `01-`, `02-` to maintain order

### Viewing Test Evidence

After running tests:
1. Check the test output directory for screenshots
2. Open the HTML report: `npx playwright show-report playwright-report`
3. Screenshots are attached to each test and visible in the report

### Best Practices

1. Use clear, descriptive names for screenshots
2. Capture screenshots at key decision points and state changes
3. Use annotations to clarify what's being tested in complex interfaces
4. Always call `clearAnnotations()` after capturing annotated screenshots
5. Include element selectors when capturing error evidence
6. Use numbered prefixes (01-, 02-, etc.) to maintain screenshot order

### Available Helper Functions

- `captureTestEvidence(page, testInfo, description)` - Capture a basic screenshot
- `captureErrorEvidence(page, testInfo, description, errorSelector?)` - Capture error with highlighting
- `highlightElement(page, selector, color?)` - Highlight an element
- `removeHighlight(page, selector)` - Remove highlight from an element
- `annotateElement(page, selector, label, position?)` - Add label annotation to element
- `clearAnnotations(page)` - Remove all annotations
- `captureStepEvidence(page, testInfo, stepName, action)` - Capture before/after screenshots for a step

### Files

- `utils/screenshot-helper.ts` - Core helper functions
- `fixtures/test-evidence.ts` - Custom Playwright fixtures
- `tests/routePlayback.spec.ts` - Example test with screenshot evidence
- `playwright.config.ts` - Configuration with screenshot settings
- `playwright.config.ci.ts` - CI configuration with screenshot settings
