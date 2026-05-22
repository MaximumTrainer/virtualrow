## Title
Realism: cascaded shadow maps (CSM) for sharp near shadows and longer cast distance

## Labels
`realism`, `graphics`, `shadows`, `enhancement`

## Summary
The primary directional sunlight in `Rower3D.tsx` uses a single 2048×2048
shadow map covering a ±100 m frustum (`shadow-camera-left/right/top/bottom = ±100`).
At the boat the texel footprint is roughly `200 m / 2048 ≈ 10 cm/texel`,
which is the source of the soft, blocky shadow seam visible under the
oars and seat in screenshots.

## Motivation
Replacing the single shadow map with a 3- or 4-cascade CSM gives crisp,
sub-centimetre shadow resolution near the boat **and** allows distant
landscape objects (buildings, trees, bridges) to cast shadows out to
several hundred metres without ballooning shadow map size.

## Proposed change
- Adopt `three-csm` (or `three.js`'s `CSM` helper) and replace the single
  `<directionalLight castShadow>` block with a CSM driver bound to the
  same sun direction (`skyConfig.sunPosition`).
- Configure cascade splits at e.g. 5 m / 20 m / 60 m / 300 m.
- Keep total VRAM ≤ current usage: four 1024² maps total ≈ same as one
  2048² map.
- Gate by `performanceMode`:
  - `high`: 4 cascades
  - `medium`: 2 cascades
  - `low`: keep the existing single shadow map (or no shadows; composes
    with #100)
- Wire fade-out so the last cascade blends to no-shadow over the last 10%
  of its range to avoid a hard seam.

## Acceptance criteria
- [ ] Shadow edges under the rower and oar locks are visually crisp at
      1080p (no blocky/staircase artefacts at typical camera distance).
- [ ] Distant trees and buildings cast a visible (if soft) shadow.
- [ ] No shadow acne or peter-panning on the deck or water surface.
- [ ] `performanceMode === 'low'` retains the current cheap path.
- [ ] Build, lint, unit tests, and the Playwright screenshot test pass.
