## Title
Perf: gate post-processing effects on `performanceMode`

## Labels
`performance`, `graphics`

## Summary
Five postprocessing effects run unconditionally: Bloom, ChromaticAberration, DepthOfField, Vignette, and ACES ToneMapping. DOF in particular is a full-screen blur pass and is the most expensive of the stack; Bloom and CA also add full-screen passes. On low-power devices the stacked passes can halve frame rate, and the visual gain for DOF on a 1080p-or-smaller workout view is marginal.

## Evidence
- `src/components/Rower3D.tsx:3595-3608` — `EffectComposer` stack: `Bloom`, ChromaticAberration `primitive`, `DepthOfField` (`height={480}`), `Vignette`, `ToneMapping`.

## Proposed approach
- In low-power mode: render only `ToneMapping` + `Vignette` (cheapest, biggest visual value).
- In high-quality mode: keep the full stack.
- Optionally bump `Bloom.luminanceThreshold` from `0.72` → `~0.85` to reduce the number of bright pixels Bloom scans.

## Out of scope
- Physics / route logic.

## Acceptance criteria
- [ ] `EffectComposer` children are conditional on `performanceMode` / `isHighQuality`.
- [ ] DOF and CA are absent in low-power mode.
- [ ] Frame-time improvement is measurable on at least one low-end target.
- [ ] Visual diff for high-quality mode shows no regression.
