## Title
Perf/Realism: replace `Math.random()` in window emissive props with stable per-window state

## Labels
`performance`, `graphics`, `bug`

## Summary
Each rendered building window currently sets its `emissiveIntensity` to `Math.random() > 0.5 ? 0.35 : 0.08` (and similar). Because this expression lives **inside JSX**, it is re-evaluated on every render. The result is non-deterministic flicker (windows randomly switching brightness on every React re-render) **and** unnecessary material-prop updates that can defeat material caching inside three.js.

This is also bad for screenshot stability and Playwright determinism.

## Evidence
- `src/components/Rower3D.tsx:1436` — `emissiveIntensity={Math.random() > 0.5 ? 0.35 : 0.08}`
- `src/components/Rower3D.tsx:1451` — `emissiveIntensity={Math.random() > 0.6 ? 0.3 : 0.06}`

## Proposed approach
- Generate a deterministic per-window "is-lit" flag once when the landscape is memoised (e.g. derive from `seedrandom`/hash of element index + window index).
- Either: (a) keep it static; or (b) animate via a time-based smooth function (sine over a long period) for slow "someone walked past the window" feel — still deterministic.
- Ensure the value no longer changes between React renders.

## Out of scope
- Physics / route logic.

## Acceptance criteria
- [ ] No `Math.random()` calls remain inside JSX prop expressions in `Rower3D.tsx`.
- [ ] Window brightness is stable across re-renders (verify visually + via Playwright screenshot diff).
- [ ] If animated, animation is driven by `clock.elapsedTime`, not React render frequency.
