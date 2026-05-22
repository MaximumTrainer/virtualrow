## Title
Realism: location-relative water character (colour, turbidity, wave spectrum, foam) per route theme

## Labels
`realism`, `graphics`, `water`, `theming`, `enhancement`

## Summary
The water shader currently varies only its surface tint and a couple of
wave amplitude scalars by theme. Real waterways differ in many more
visible dimensions: colour and turbidity (tea-brown Thames vs. emerald
Bled), wave spectrum (open-channel chop vs. canal slap vs. lagoon
flat), foam patterns, and how strongly the sky reflects vs. the
underwater medium absorbs.

## Motivation
Water occupies ~50% of every frame. Giving each location its own water
"identity" is one of the highest-impact location-realism investments.

## Proposed change
Extract a `WATER_PROFILES: Record<RouteTheme, WaterProfile>` table
(`src/three/waterProfiles.ts`). Each profile contains:
- `surfaceTint` (sRGB), `deepColor` (absorbed-light colour at depth)
- `turbidity` (0–1, drives how quickly light is attenuated downward)
- `waveSpectrum`: `{ choppy: number, swell: number, ripple: number }`
  feeding the existing Gerstner wave stack — e.g. Bled is `{ 0.05, 0.1, 0.4 }`
  (mostly ripples), open Thames is `{ 0.7, 0.5, 0.3 }`.
- `foamColor`, `foamCoverage` (e.g. Venice has tea-stain edge foam at
  canal walls, Thames has greasy yellow foam, Bled has none)
- `reflectionStrength` (combines with the planar-reflection proposal)
- `causticIntensity` (combines with the caustics proposal)
- `flotsam`: which debris sprites can spawn (Thames: bottles, oil
  slicks; Venice: leaves; Bled: none; Boston: lit holographic markers)

Theme-specific targets:
- **Willowbrook**: clear green-brown, light ripple, low foam.
- **Crystal Bled**: emerald-turquoise with high deep-colour absorption
  giving the famous Bled-lake green; almost mirror-flat; rare ripples.
- **Gothic Venice**: dark, low-saturation green-grey; canal-slap wave
  spectrum reflecting off the wall (add a perpendicular reflected
  wave train).
- **Steampunk Henley**: tea-coloured Thames water, gentle following
  swell, golden specular peaks.
- **Dystopian Thames**: opaque brown-grey, oily rainbow patches as a
  texture overlay, dim reflection.
- **Sci-fi Boston**: very dark with neon caustic reflections of signs
  and bridges (high reflection, low underwater colour).

## Acceptance criteria
- [ ] Each theme has a distinct dominant water colour visible without
      reading the label.
- [ ] Wave spectrum differs measurably between Bled (smooth) and
      open Thames (choppy).
- [ ] Edge/wall foam appears in Venice but not in Bled.
- [ ] Flotsam sprites appear only in their assigned themes.
- [ ] All values are validated by a unit test that every `RouteTheme`
      key has every required field.
- [ ] `npm run lint`, `npm run test -- --run`, `npm run build` pass.
