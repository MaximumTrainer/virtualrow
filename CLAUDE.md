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
npx tsc --noEmit -p tsconfig.app.json  # Type-check app (bare `tsc --noEmit` checks nothing:
                         #   the root tsconfig is solution-style, files: [])
npx tsc -p tsconfig.playwright.json --noEmit  # Type-check E2E suite
npx vitest run           # Unit tests (jsdom)
npx vitest run --coverage # Unit tests with v8 coverage
npm run test:e2e         # Playwright E2E. Builds the app and serves it at the
                         #   deploy's base path; it owns the server, so do not
                         #   start `npm run dev` first. BASE_URL=... points it
                         #   at a server you are already running instead.
npm run test:e2e:ci      # The same, with CI settings and retries
npm run test:e2e:endurance # The long route traverses (#272), their own CI job
npm run test:e2e:stress  # The heavy stress traverse (#301), scheduled only
npm run test:visual      # Visual baselines (#340). Compares one frozen frame per
                         #   tier/viewport with a committed PNG. Baselines are
                         #   recorded on Linux/SwiftShader in CI, never from a local
                         #   GPU — put the `visual-baseline` label on the PR and
                         #   commit the artifact the `visual` job uploads.
npm run test:visual:update # Re-record those baselines (CI only, see above)
npm run verify           # Lint + type-check + full unit suite (what pre-push runs)
npm run test:contract    # Live check against the rownative mirror (network, opt-in)
npm run verify:staged    # TDD guard alone, against the current git index
npm run hooks:install    # Point git at .githooks (also runs on npm install)
```

### Verification gates

`pre-commit` blocks a commit that stages production code without a test, a focused
spec (`it.only`), or a lowered coverage threshold — then runs lint, `tsc` and the
related unit tests. `pre-push` runs the full CI set. Both live in [.githooks/](.githooks/);
see [agents.md](agents.md) §1 and §6 for the rules and the escape hatches
(`VERIFY_FULL=1`, `TDD_GUARD=off`, `SKIP_HOOKS=1`).

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
  Removing a file from `coverage.exclude` is the one case where the global ratio may fall while tested-ness rises —
  pin the newly measured file with a per-file threshold and say so in the config comment (#343).
- **BLE frames match parsers**: test frames in mock-bluetooth.js and Playwright specs must match the wire format in `src/vendor/pm5-base.js` and `src/services/ftmsBluetoothService.ts`.
- **The FIT encoder is ours**: `fitEncoderService` is hand-written and lazy-loaded. `@garmin/fitsdk` is a **devDependency** used only by the round-trip decode test — never import it from `src/`.

## Shared agent skills

Shared skills live in [MaximumTrainer/agent-skills](https://github.com/MaximumTrainer/agent-skills). Before writing a new
skill, runbook or repeated procedure, check the catalogue - and send genuinely
general improvements back so the other repositories get them too.

```bash
python3 .claude/skills/skill-exchange/scripts/skills.py list
python3 .claude/skills/skill-exchange/scripts/skills.py status
```

See `.claude/skills/skill-exchange/` for the workflow.
