# VirtualRow — Architecture & Implementation Rules

This document defines the codebase architecture and the implementation discipline every contributor (human or agent) follows. Read it before writing code.

## What this is

A browser-based rowing simulator. A rower connects a Concept2 PM5 or FTMS-compatible ergometer and a heart-rate strap via Web Bluetooth, picks a water course, and rows it in a real-time 3D scene. Courses come from rownative.icu (via its public GitHub mirror) or from user-imported GPX/KML/GeoJSON files.

Stack: React 19, TypeScript (strict), Vite, Three.js via React Three Fiber, Vitest, Playwright.

## Architecture

### Layers

```
src/
  ports/          ← port interfaces (Pick<ConcreteService, ...>)
  services/       ← service implementations (business logic, BLE adapters, API clients)
  hooks/          ← React hooks (state, subscriptions, physics)
  components/     ← React components (UI, 3D scene)
    rower3d/      ← Three.js scene graph components and helpers
  context/        ← React context providers (Auth, Services DI)
  types/          ← shared type definitions
  utils/          ← pure functions (parsers, coordinate math, exporters)
  vendor/         ← vendored third-party code (pm5-base.js)
```

Dependencies flow inward: components depend on hooks and ports, hooks depend on ports, ports are structural types satisfied by services. Services depend on nothing inside the app except types and utils.

### Ports and services

The app uses hexagonal-style ports (`src/ports/index.ts`). Each port is a `Pick<ConcreteService, ...>` — a structural type listing only the methods the app actually calls. Components and hooks depend on port types, never on concrete service classes.

A `Services` aggregate interface gathers all nine ports. The `ServicesProvider` context injects real service instances at the composition root; tests supply plain object stubs that satisfy the same structural types without casts.

**Services** (under `src/services/`):

| Concern | Service | What it owns |
|---|---|---|
| PM5 BLE | `bluetoothService` | Wraps vendored `pm5-base.js`; parses general/additional/multiplexed status into `PM5Data` |
| FTMS BLE | `ftmsBluetoothService` | Standard FTMS 0x1826 rower; parses bitfield Rower Data into the same `PM5Data` shape |
| Heart rate BLE | `heartRateBluetoothService` | HR Service 0x180D; ring buffer of 1200 samples; exposes `simulateSample()` for test injection |
| Route catalogue | `routeService` | In-memory `WaterRoute[]`; imports from GPX/GeoJSON/KML/rownative; calculates polyline distance |
| Route enrichment | `routeEnrichmentService` | Fetches elevations (OpenTopoData) and land-use (Overpass); builds 50m segment profiles; caches in localStorage with 7-day TTL |
| Rownative courses | `rownativeService` + `rownativeGeometry` | Fetches from GitHub mirror; resolves geometry via precedence chain (track → polygon-path → gate-chain); validates against gate centroids |
| Workout sessions | `workoutService` + `activitySampler` | Session lifecycle, PM5 data accumulation, 500m splits, HR samples, the 1 Hz activity stream, CSV/JSON export |
| FIT encoding | `fitEncoderService` | Hand-written binary FIT Activity encoder; pure `encodeSession(session)`, reached by dynamic `import()` so it stays out of the main chunk |
| Activity upload | `intervalsIcuActivityService` | Multipart `POST` of the encoded FIT to intervals.icu via the CORS proxy; 401-refresh-retry, duplicate suppression |
| Workout generator | `workoutGeneratorService` | Structured workout templates, intervals.icu import, segment-level progress tracking |
| Auth | `authService` | OAuth 2.0 PKCE with intervals.icu via CORS proxy |

BLE services communicate via EventEmitter-style `on`/`off`/`emit`. Non-BLE services use direct method calls.

### Data flow: BLE → UI → 3D

```
BLE characteristic notification
  → service parser (PM5Data)
    → useRowerServiceEvents hook (on/off subscription via ref)
      → workoutService.updateSessionWithPM5Data()  [sync]
      → requestAnimationFrame → setPM5Data() / setCurrentSession()  [React state]
        → Rower3D receives pm5Data as props
          → distanceToProgress() → boat position on CatmullRom curve
```

### 3D scene composition

`Rower3D.tsx` lazy-loads a React Three Fiber `<Canvas>` with Rapier physics. The scene graph includes: water surface (Gerstner waves), curved water channel and riverbanks following the route curve, procedural terrain with elevation-driven relief, instanced vegetation (PineTrees, GroundCover) offset by terrain Y, the rowing scull model, wake/splash particle effects, per-route themed landscape overlays, and post-processing (bloom, color grading, vignette).

Route coordinates → `createRouteCurve()` → Three.js CatmullRomCurve3. Enrichment segment profiles drive scenery placement, water width, and terrain relief per 50m segment.

### State management

No external state library. State lives in:
- **App.tsx `useState`**: view mode, routes, selected route, session, BLE connection status, PM5 data, HR samples, enrichments
- **Mutable refs**: re-entrancy guards, RAF throttling, timer handles (non-rendering state that must not trigger re-renders)
- **React contexts**: `AuthContext` (OAuth state), `ServicesContext` (port injection)
- **Custom hooks**: `usePhysicsEngine` (boat physics via mutable ref, re-renders only on stroke phase change), `useRowerServiceEvents` (BLE subscription via ref)

### External integrations

| Service | Access | Notes |
|---|---|---|
| rownative.icu courses | GitHub mirror (`raw.githubusercontent.com/rownative/courses/`) | CORS-locked live API; mirror is the sole data path. Mirror, `/api/courses` and `/courses` all serve the same 169 courses with identical ids (measured 2026-09-03). Ids run to 277 with gaps — that maximum is where the old "277 live courses, ~60% mirror coverage" figure came from |
| intervals.icu | OAuth PKCE via CORS proxy | Token exchange, profile, planned workout calendar, and activity upload (`POST /api/v1/athlete/0/activities`, multipart FIT). The proxy forwards multipart `POST` unchanged — verified, see MaximumTrainer_Redux#359 |
| OpenTopoData | `api.opentopodata.org/v1/srtm30m` | Batched in groups of 100 coordinates |
| Overpass API | `overpass-api.de/api/interpreter` | Land-use, waterway, building queries by bounding box |

---

## Implementation rules

### 1. Outside-in TDD

Write tests first, from the outside in. Start at the boundary the user or caller touches, then work inward to the detail.

**The cycle:**

1. **Write a failing acceptance test** that describes the behaviour from the caller's perspective. For a service method, this is a unit test exercising the public API against stubs. For a UI feature, this is a Playwright E2E test or a React Testing Library integration test. This test names what the feature does, not how.

2. **Write a failing unit test** for the next piece of internal logic needed to make the acceptance test pass. This is the inner loop — classic red-green-refactor at the function or class level.

3. **Make it pass** with the simplest code that works. No speculative generality.

4. **Refactor** while all tests stay green. Extract, rename, reshape. This is where clean code happens — after the behaviour is locked in, not before.

5. **Repeat** the inner loop until the outer acceptance test goes green.

**What this means in practice:**

- A PR that adds behaviour ships with tests that preceded the implementation. The commit history shows test-first when it matters; the review shows coverage that matches the change.
- Do not write infrastructure (helpers, abstractions, utilities) before the test that needs them. Let the test pull the design into existence.
- Do not mock what you own unless the real thing is slow or has side effects. Prefer stubs (plain objects satisfying a port type) over mock libraries.
- When fixing a bug, first write a test that reproduces it. Then fix.

### 2. Test organisation

**Unit tests (Vitest):**
- Live in `src/__tests__/`, mirroring the source structure by name.
- Environment: jsdom. Globals enabled (no explicit `describe`/`it`/`expect` imports).
- Use `@testing-library/react` + `@testing-library/user-event` for component tests.
- Fixtures in `src/__tests__/fixtures/`.
- Coverage thresholds are enforced in `vitest.config.ts` and ratchet upward — never lower them.

**E2E tests (Playwright):**
- Live in `playwright/tests/`.
- BLE is mocked via `playwright/mock-bluetooth.js` (injected as init script).
- PM5/HR data is simulated via `playwright/simulators/sim-server.js` over WebSocket.
- PM5 frame helpers (`dispatchGeneralStatus`, `dispatchAdditionalStatus`) live at file scope in the spec and match the wire format parsed by `src/vendor/pm5-base.js` exactly. When writing BLE test frames, verify byte layout against the parser — the PM5 general status has elapsedTime (24-bit LE, ×0.01s) at offset 0 and distance (24-bit LE, ×0.1m) at offset 3.
- Type-checked via `tsconfig.playwright.json`.

### 3. Clean, fluent code

**Naming is the design.** A well-named function doesn't need a comment. Name functions for what they return or what effect they have. Name variables for what they hold. Name types for what they represent. If you can't name it clearly, the abstraction is wrong.

**Small functions, each doing one thing.** A function should be short enough to hold in your head. If it needs a section comment, it needs extraction. Prefer pure functions — given the same input, same output, no side effects.

**Fluent chains over imperative steps.** Prefer `coordinates.filter(isValid).map(toLatLng)` over a for-loop with conditionals and a push. Let the data flow read like a sentence.

**No premature abstraction.** Three concrete examples before you extract a pattern. A helper that's called once is overhead, not reuse. Inline is fine.

**No speculative generality.** Don't add parameters "in case someone needs them." Don't build extension points nobody asked for. Don't design for hypothetical future requirements. Solve the problem in front of you.

**Types carry intent.** Use discriminated unions (`status: 'success' | 'error'`) over boolean flags. Use branded types or newtypes when a primitive could be confused (`ParsedCoordinateList` instead of a bare `Coordinate[]` that loses the drop count). Let the type system prevent mistakes the tests shouldn't have to catch.

**Errors at the boundary, trust inside.** Validate and constrain at system edges (user input, external API responses, file parsing). Inside the app, trust the types. Don't litter internal code with defensive null checks against states the type system already prevents.

### 4. Structural rules

- **Port types are `Pick<>`, never aliases.** A port is `Pick<ConcreteService, 'method1' | 'method2'>` — a structural type. Never `type Port = ConcreteService`. This ensures stubs are plain objects checked structurally, not class instances needing unsafe casts.

- **Services are stateless singletons** instantiated at module scope. They hold configuration and caches, not request-scoped state. Session state belongs in `workoutService`.

- **Components depend on port types** via `useServices()`. Never import a concrete service class into a component.

- **New React state belongs in hooks**, not in App.tsx, unless it coordinates multiple views. App.tsx is already large; extract new feature state into custom hooks.

- **BLE frame layouts must match the parser.** When constructing test frames for PM5 or FTMS characteristics, verify the byte layout against the parser in `src/vendor/pm5-base.js` or `src/services/ftmsBluetoothService.ts`. The mock-bluetooth and Playwright helpers both build wire-format frames — if they disagree with the parser, the tests pass for the wrong reasons.

- **Coordinate order is [lng, lat] in GeoJSON** (RFC 7946) and `{ lat, lng }` in internal `Coordinate` types. Never mix them. Exporters must flip; importers must flip back.

- **Track parsers return `ParsedCoordinateList`** (`{ coordinates, dropped, total }`), not bare arrays. The drop allowance (one point or 10% of total, whichever is larger) is checked in `parseTrackFile` and applies uniformly to GPX, KML, and GeoJSON.

- **Coverage thresholds ratchet.** When your change improves coverage, raise the thresholds in `vitest.config.ts` to the new floor. Never lower them to make a PR pass.

- **A completed row is recorded once per second, and its position comes from the route.** `ActivitySample` is the unit the FIT encoder writes records from. Positions are `distance` interpolated along the selected route's polyline (`interpolateAlong`), so an exported track covers the water actually rowed rather than the whole course. Do not reintroduce a sample cap: truncating the series silently falsifies the averages computed at `endSession()`.

- **Simulated rows never leave the browser.** A guest row and a demo row are both excluded from the upload *and* from local persistence. The rule lives in `intervalsIcuActivityService.uploadActivity` and `saveCompletedSession`, not at the call-sites.

### 5. Commit discipline

- One logical change per commit. A bug fix, a feature, a refactor — not all three.
- Commit message: imperative mood, describes what the change does and why. No "fix stuff" or "updates".
- Tests and implementation in the same commit when they're part of the same logical change.
- Reference issue numbers in commit messages when the change closes or advances an issue.

### 6. What not to do

- Don't add comments that restate the code. Only comment the *why* when it's non-obvious.
- Don't add `// TODO` without an issue number.
- Don't add feature flags, backwards-compatibility shims, or `_unused` variable renames.
- Don't mock `localStorage`, `fetch`, or the DOM when a jsdom stub or MSW handler does the job.
- Don't add dependencies without justification. This is a browser app with a small bundle budget.
- Don't write Playwright tests that assert on specific pixel positions or animation frame counts — they're flaky across platforms.
- Don't dispatch the same BLE DataView to multiple characteristics with different parsers — each characteristic has its own wire format.
