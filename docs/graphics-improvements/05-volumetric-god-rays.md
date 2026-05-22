## Title
Realism: volumetric god rays / sun shafts aligned to directional light

## Labels
`realism`, `graphics`, `post-processing`, `atmosphere`, `enhancement`

## Summary
The current `EffectComposer` chain in `src/components/Rower3D.tsx`
(`Bloom` → `ChromaticAberration` → `DepthOfField` → `Vignette` →
`ToneMapping`) has no volumetric scattering pass, so the air itself
does not pick up any directional brightness. Several of the route
themes (`steampunk-henley`, `dystopian-thames`, `gothic-venice`)
explicitly evoke low-sun, hazy lighting via warm directional-light
colours, but without a god-rays pass the implied atmosphere never
materialises. This is what makes early-morning rowing footage feel
atmospheric: light shafts cutting through bridges, trees, and the
boat itself.

## Motivation
A cheap screen-space god-rays pass (radial blur of bright pixels around
the projected sun position) converts our existing strong directional
light into a directly-perceived volumetric effect, reinforcing whichever
time-of-day the theme implies.

## Proposed change
- Add a screen-space god-rays / `GodRaysEffect` from `postprocessing` to
  the `EffectComposer` chain, attached to a small invisible sun-disc
  mesh placed at `skyConfig.sunPosition` in world space.
- Tune `density`, `decay`, `weight`, `exposure` per theme via the same
  switch pattern already used for sun colour.
- Disable on `performanceMode === 'low'` and on themes where the sun is
  obscured (e.g. `scifi-boston` night).

## Acceptance criteria
- [ ] God rays appear when the sun is partially occluded by trees,
      buildings, or the boat itself, and disappear when fully behind the
      camera.
- [ ] Tied to the existing `skyConfig.sunPosition` so it tracks the
      directional light.
- [ ] No effect when `performanceMode === 'low'`.
- [ ] No new lint or type errors. `npm run build` passes.

## References
- `postprocessing` GodRaysEffect: https://pmndrs.github.io/postprocessing/public/docs/class/src/effects/GodRaysEffect.js~GodRaysEffect.html
