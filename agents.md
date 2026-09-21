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
| Rownative courses | `rownativeService` + `rownativeGeometry` | Fetches from GitHub mirror; resolves geometry via precedence chain (track → polygon-path → gate-chain); validates against gate centroids. The `track` slot takes an upstream `path` field (proposed in rownative/courses#23, not yet in the mirror) or a rower-attached track |
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
- Commit red-to-green in one commit. The test and the code that satisfies it are the same logical change (§5); the point is that the test existed first, not that it was pushed first.

**This is enforced, not merely encouraged.** The `pre-commit` hook runs `scripts/tdd-guard.mjs` over the git index and blocks a commit when:

| Situation | Verdict |
|---|---|
| A **new** module under `src/` with no staged test naming it | blocked |
| A **changed** module that no test anywhere names | blocked |
| A changed module covered by an existing test, with no test change staged | warning — the refactor path |
| A staged spec containing `it.only` / `describe.only` / `test.only` | blocked |
| A coverage threshold in `vitest.config.ts` edited downward or deleted | blocked |
| A threshold lowered in the same change that removes a `coverage.exclude` entry | allowed — the denominator grew |

"Names it" means a test file under `src/__tests__/` or `playwright/tests/` mentions the module's basename — `routeService.ts` is covered by any spec that references `routeService`. Exemptions are not a second list to maintain: the guard reads `test.coverage.exclude` from `vitest.config.ts`, so anything that counts toward the coverage gate needs a test, and anything excluded there (the R3F scene, vendored code, generated bindings, `src/data/`) does not.

See §6 for the full gate and its escape hatches.

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

**Visual baselines (Playwright, #340):**
- Live in `playwright/tests/visual/`, with their PNGs in `playwright/tests/visual/__snapshots__/`.
- Excluded from every other config, so the verification matrix does not run them.
- A shot is only meaningful on the rasteriser that drew it. They are recorded on
  one Linux/SwiftShader CI job and nowhere else — never from a developer GPU,
  never on the Windows or macOS legs. Put the `visual-baseline` label on the pull
  request, let the `visual` job re-record and then re-compare, and commit the
  PNGs it uploads as an artifact.
- The scene holds still for the camera via `window.__ROWER3D_FREEZE`
  (`src/components/rower3d/sceneFreeze.ts`), which pins the clock, the boat's
  progress along the route and the stroke cycle. Anything new that animates
  should read its time through `useAnimationFrame` or `frozenClock`, or it will
  be the one thing in a frozen frame that still moves.

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
  The one exception is removing a `coverage.exclude` entry: that puts unmeasured code into the denominator, so the ratio can fall while the
  amount of tested code rises. Pin the newly measured file with a per-file threshold so the trade cannot be made twice, and say in the config
  comment what moved. The guard recognises this case and allows it (#343).

- **A completed row is recorded once per second, and its position comes from the route.** `ActivitySample` is the unit the FIT encoder writes records from. Positions are `distance` interpolated along the selected route's polyline (`interpolateAlong`), so an exported track covers the water actually rowed rather than the whole course. Do not reintroduce a sample cap: truncating the series silently falsifies the averages computed at `endSession()`.

- **Simulated rows never leave the browser.** A guest row and a demo row are both excluded from the upload *and* from local persistence. The rule lives in `intervalsIcuActivityService.uploadActivity` and `saveCompletedSession`, not at the call-sites.

### 5. Commit discipline

- One logical change per commit. A bug fix, a feature, a refactor — not all three.
- Commit message: imperative mood, describes what the change does and why. No "fix stuff" or "updates".
- Tests and implementation in the same commit when they're part of the same logical change.
- Reference issue numbers in commit messages when the change closes or advances an issue.

### 6. Verification gates

Three gates run the same checks at widening scope. Each one is the previous one plus what it can afford at that point in the loop.

| Gate | Runs | Roughly |
|---|---|---|
| `pre-commit` (`.githooks/pre-commit`) | TDD guard → ESLint on staged files → `tsc --noEmit` → `vitest related` for the staged files | seconds |
| `pre-push` (`.githooks/pre-push`) | `npm run lint` → `npm run build` → `npm run coverage` (full suite + thresholds) | ~2 minutes |
| CI (`.github/workflows/playwright-e2e-clean.yml`) | the preflight set, plus a shuffled-order run, then Playwright E2E on Linux, Windows and macOS | minutes |

**Installation is automatic.** `npm install` runs `prepare` → `scripts/install-hooks.mjs`, which sets `core.hooksPath` to `.githooks`. Wire an existing clone up by hand with `npm run hooks:install`. The hooks are version-controlled, so a change to the gate arrives with a `git pull` rather than a wiki page nobody reads.

**Escape hatches, in order of preference:**

```bash
VERIFY_FULL=1 git commit    # run the whole unit suite instead of the related tests
TDD_GUARD=off git commit    # skip the TDD guard only — a genuine no-behaviour change
SKIP_HOOKS=1 git commit     # skip the hook entirely
git commit --no-verify      # same, via git
```

Reaching for the last two is a judgement call you should be able to defend in review. Reaching for them repeatedly means the gate is wrong — fix the gate, in a commit of its own, rather than routing around it.

**What the guard reads.** Pairing, focused specs and thresholds are judged against the *index* — `git show :path` — so a half-staged change is assessed as the commit it would become. Lint, types and tests run against the working tree, which is the usual pragmatic trade: keep the tree and the index in step while committing.

**Two known limits of the heuristics**, both deliberate — the guard is a floor, not a proof:

- Pairing matches a module's basename anywhere in a staged spec, so an unrelated spec that happens to mention the name satisfies it.
- A focused spec is detected at the head of a line, which is where a real `it.only` lives; one nested inside a single-line expression slips through to CI, where vitest fails the run on `.only` anyway.

**The guard's own logic is unit-tested** (`src/__tests__/tddGuard.test.ts`). Change the rules there test-first, like everything else.

### 7. What not to do

- Don't add comments that restate the code. Only comment the *why* when it's non-obvious.
- Don't add `// TODO` without an issue number.
- Don't add feature flags, backwards-compatibility shims, or `_unused` variable renames.
- Don't mock `localStorage`, `fetch`, or the DOM when a jsdom stub or MSW handler does the job.
- Don't add dependencies without justification. This is a browser app with a small bundle budget.
- Don't write Playwright tests that assert on specific pixel positions or animation frame counts — they're flaky across platforms.
- Don't dispatch the same BLE DataView to multiple characteristics with different parsers — each characteristic has its own wire format.

## Shared agent skills

Shared skills live in [MaximumTrainer/agent-skills](https://github.com/MaximumTrainer/agent-skills). Before writing a new
skill, runbook or repeated procedure, check the catalogue - and send genuinely
general improvements back so the other repositories get them too.

```bash
python3 .claude/skills/skill-exchange/scripts/skills.py list
python3 .claude/skills/skill-exchange/scripts/skills.py status
```

See `.claude/skills/skill-exchange/` for the workflow.
