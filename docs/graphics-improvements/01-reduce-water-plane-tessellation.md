## Title
Perf: reduce water plane tessellation from 128×128 to ~48×48 segments

## Labels
`performance`, `graphics`, `good first issue`

## Summary
The main water plane is created with 128×128 segments (≈16,384 quads / ~32k triangles) — the highest single contributor to vertex shader cost in the scene. Gerstner waves displace vertices on the GPU and visually do not benefit from this density at the camera distances we render. Reducing tessellation cuts a large per-frame cost without any visible quality regression.

## Evidence
- `src/components/Rower3D.tsx:602` — `<planeGeometry args={[1000, 1000, 128, 128]} />`
- Comment on `src/components/Rower3D.tsx:601` even acknowledges *"128×128 segments — enough tessellation for Gerstner waves on the GPU"* — but this is over-provisioned.

## Proposed approach
- Lower default segments to `48×48` (≈4,608 quads).
- Optionally key it off `performanceMode`: `64×64` for high, `32×32` for low.
- Visually diff before/after with the Playwright screenshot test (`docs/screenshot-rower-3d.png`) to confirm no perceptible quality drop.

## Out of scope
- Wave physics. No change to the Gerstner-wave shader math.
- Boat/route/physics behaviour.

## Acceptance criteria
- [ ] Water plane segments reduced (single value or perf-mode-aware).
- [ ] Frame time on the workout activity screen improves on at least one of the CI runners (or measurable locally via React DevTools profiler / browser perf trace).
- [ ] Playwright docs screenshot regenerates cleanly with no diff worse than antialiasing noise.
