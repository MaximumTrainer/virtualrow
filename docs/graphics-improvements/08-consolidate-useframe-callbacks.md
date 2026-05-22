## Title
Perf: consolidate per-component `useFrame` callbacks in scenery components

## Labels
`performance`, `graphics`, `refactor`

## Summary
Many scenery components each call `useFrame` independently — water surface, mist layers, clouds, the boat, and several landscape components. Every `useFrame` participates in r3f's render-loop scheduler and adds JS overhead per frame. Animation logic that only needs `delta` / `elapsedTime` can be passed down through context or a single parent callback, reducing scheduler churn and giving us one place to throttle animations on low-power devices.

## Evidence (non-exhaustive)
- `src/components/Rower3D.tsx:578` — water animation `useFrame`.
- `src/components/Rower3D.tsx:703` — mist layer `useFrame`.
- `src/components/Rower3D.tsx:2702` — clouds `useFrame`.
- `src/components/Rower3D.tsx:3673` — boat movement `useFrame`.

## Proposed approach
- Introduce a small `<AnimationContext>` that publishes `elapsedTime` / `delta` (and optionally a low-power flag).
- Convert scenery animations that only read time to consume the context and update their refs imperatively in a single parent `useFrame`.
- Leave the boat/rower `useFrame` alone if it interacts with refs that don't suit context-driven flow (don't touch physics paths).

## Out of scope
- Boat physics / route logic. The boat's `useFrame` and any physics-adjacent loop is **not** to be restructured.

## Acceptance criteria
- [ ] Number of distinct `useFrame` callbacks in the scene reduced.
- [ ] Profiling shows fewer render-loop entries per frame in React DevTools / browser perf.
- [ ] No regression in visible animation smoothness.
