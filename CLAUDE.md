# VirtualRow

Browser-based rowing simulator — React 19, TypeScript (strict), Vite, Three.js (React Three Fiber), Vitest, Playwright.

## Read first

Read [agents.md](agents.md) for the full architecture description and implementation rules. That file is the authority on how code is written here.

## Quick reference

### Commands

```bash
npm run dev              # Start dev server (Vite)
npm run build            # Production build
npm run lint             # ESLint (flat config, zero warnings policy)
npx tsc --noEmit         # Type-check app
npx tsc -p tsconfig.playwright.json --noEmit  # Type-check E2E suite
npx vitest run           # Unit tests (907 tests, jsdom)
npx vitest run --coverage # Unit tests with v8 coverage
npm run test:e2e         # Playwright E2E (local, needs dev server)
npm run test:e2e:ci      # Playwright E2E (CI, retries=2)
```

### Project structure

```
src/ports/        Port interfaces (Pick<Service, ...> structural types)
src/services/     Service implementations (business logic, BLE, API clients)
src/hooks/        Custom React hooks (physics, BLE subscriptions)
src/components/   React components and Three.js scene (rower3d/)
src/context/      React context providers (Auth, Services DI)
src/types/        Shared TypeScript types
src/utils/        Pure utility functions (parsers, coordinate math, exporters)
src/vendor/       Vendored pm5-base.js (Concept2 PM5 BLE library)
playwright/       E2E tests, mock BLE, simulators
```

### Key conventions

- **Outside-in TDD**: write the failing test first, then make it pass, then refactor.
- **Ports over classes**: components depend on port types via `useServices()`, never on concrete service classes.
- **`ParsedCoordinateList`**: all track parsers return `{ coordinates, dropped, total }`, not bare arrays.
- **Coordinate order**: internal = `{ lat, lng }`, GeoJSON export = `[lng, lat]` per RFC 7946.
- **Coverage ratchets up**: raise thresholds in `vitest.config.ts` when your change improves coverage. Never lower them.
- **BLE frames match parsers**: test frames in mock-bluetooth.js and Playwright specs must match the wire format in `src/vendor/pm5-base.js` and `src/services/ftmsBluetoothService.ts`.
- **The FIT encoder is ours**: `fitEncoderService` is hand-written and lazy-loaded. `@garmin/fitsdk` is a **devDependency** used only by the round-trip decode test — never import it from `src/`.
