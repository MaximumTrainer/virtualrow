## Title
Realism: add screen-space ambient occlusion (N8AO or GTAO) to post-processing chain

## Labels
`realism`, `graphics`, `post-processing`, `enhancement`

## Summary
The current `EffectComposer` chain in `src/components/Rower3D.tsx`
(`Bloom` → `ChromaticAberration` → `DepthOfField` → `Vignette` →
`ToneMapping`) has no ambient-occlusion pass. As a result, contact shadows
where the boat meets the water, where the rower's hands meet the oar
handles, and where seat / footrest / track meet are physically missing —
which reads to the eye as "floating" geometry.

## Motivation
SSAO/GTAO is one of the highest-impact realism additions per millisecond
of GPU cost. It grounds objects to surfaces and dramatically improves the
perceived material response of the carbon hull.

## Proposed change
- Add either `N8AO` (recommended; cheap and high quality, available as
  `@react-three/postprocessing`'s `N8AO` or the `n8ao` package) or the
  `GTAOEffect` from `postprocessing` to the existing `EffectComposer`.
- Insert it **before** `Bloom` so AO darkens crevices before highlights are
  computed.
- Gate by `performanceMode`:
  - `high`: full-resolution, 16 samples
  - `medium`: half-resolution, 8 samples
  - `low`: disabled (composes with the gating proposed in #99 / #82)
- Default `intensity` ~1.0, `aoRadius` ~0.5–1.0 m, `distanceFalloff` ~0.2.

## Acceptance criteria
- [ ] AO is visible in screenshots under the rower's seat, around the oar
      locks, and at the hull/water interface.
- [ ] Frame time on a mid-range integrated GPU does not regress by more
      than ~2 ms at 1080p in `high` mode.
- [ ] No new console warnings about depth buffer access.
- [ ] AO is disabled when `performanceMode === 'low'`.
- [ ] `npm run lint`, `npm run test -- --run`, `npm run build` all pass.

## References
- N8AO: https://github.com/N8python/n8ao
- `@react-three/postprocessing` README on AO integration.
