## Title
Kinematics: make stroke cycle/phase a single source of truth (oars, rower, foam, telemetry)

## Labels
`enhancement`, `3d`, `gameplay`

## Summary
Stroke/boat/oar motion is currently driven by multiple independent “clocks” and the stroke-phase telemetry/effects are not wired end-to-end. This makes it hard to keep oar animation, rower body kinematics, wake/foam timing, and test telemetry consistent — and it blocks future work like drive-vs-recovery-dependent effects.

This issue proposes centralising stroke-cycle timing and stroke-phase derivation so:
- Animations (oars/rower) and visual effects (blade-entry foam) agree on *when* “catch/drive/finish/recovery” occur.
- Playwright telemetry reflects the real phase rather than a placeholder.

## Evidence
- `src/hooks/usePhysicsEngine.ts:23` — `DEFAULT_STATE.strokePhase` is initialised to `'recovery'`
- `src/hooks/usePhysicsEngine.ts:27` — `DEFAULT_STATE.strokeCycleT` initialised to `0`
- `src/hooks/usePhysicsEngine.ts:65` — `dispatchTick()` updates velocity/position/acceleration but does **not** update `strokePhase` or `strokeCycleT`
- `src/components/Rower3D.tsx:2812` — `RowingScullBase` computes its own `phase` from `elapsedTime` + `cadence` (independent of physics/telemetry)
- `src/components/Rower3D.tsx:3780` — Playwright telemetry exports `window.__ROWER3D_STROKE_PHASE = boatState.strokePhase`
- `src/components/Rower3D.tsx:3997` — blade-entry foam is driven by `strokePhase={boatState.strokePhase}` (so phase accuracy matters for visuals)

## Proposed approach
- Extend `usePhysicsEngine()` to advance `strokeCycleT` every tick using `dt` and `pm5Data.cadence` (or a default cadence when missing).
- Derive `strokePhase` from `strokeCycleT` using explicit phase boundaries (e.g. catch/drive/finish/recovery fractions).
- Ensure the same `strokeCycleT`/`strokePhase` is used to drive:
  - RowingScull oar sweep + rower body kinematics (instead of re-deriving a separate time-based phase inside `RowingScullBase`).
  - BladeEntryFoam timing (catch transition) and any future drive-only splashes.
  - Playwright telemetry (`__ROWER3D_STROKE_PHASE`) for deterministic assertions.
- Add/extend unit tests around `usePhysicsEngine()` to validate phase progression for a fixed cadence and fixed `dt` sequence.

## Out of scope
- Route geometry / GPS path sampling (no change to curve generation or progress mapping).
- Hydrodynamics/force model accuracy (this is a kinematics/timing unification task, not a physics simulation rewrite).

## Acceptance criteria
- [ ] `strokeCycleT` advances every frame and wraps deterministically to `[0, 1)`.
- [ ] `strokePhase` cycles through `catch → drive → finish → recovery` with clear, documented boundaries.
- [ ] RowingScull animation and BladeEntryFoam timing use the same phase source (no duplicate, drift-prone phase clocks).
- [ ] Tests cover phase progression and at least one boundary transition (e.g. recovery→catch).
