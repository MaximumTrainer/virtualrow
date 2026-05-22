## Title
Realism: animated water caustics light-cookie projected onto hull and oar blades

## Labels
`realism`, `graphics`, `water`, `lighting`, `enhancement`

## Summary
Under direct sunlight, water surface ripples focus light into shifting
bright patterns on any object near the waterline — including the
underside of the hull and the wet face of the oar blades. The scene
currently has no such effect, so the hull and blades read as if lit by
a flat studio light rather than by sun reflecting off water.

## Motivation
A subtle caustics pass is one of the cheapest "this is outdoors on
water" cues we can add. Even at low intensity it sells the lighting.

## Proposed change
- Generate a tiling caustics texture (either author a 6-frame animated
  loop or compute procedurally from the Gerstner wave normals at low
  resolution).
- Project it as a `SpotLight` cookie (or via a custom shader uniform on
  the hull/blade `MeshPhysicalMaterial`) from below the directional
  sun, with intensity falling off above the waterline.
- Animate the caustics texture offset over time with the same speed/dir
  parameters used by the water shader so it is visually consistent.
- Apply only to materials within ~0.5 m of `y = 0` (the water plane).

## Acceptance criteria
- [ ] A subtle shifting bright pattern is visible on the underside of
      the hull and on the wet face of the blade after release.
- [ ] The pattern animates in sync with the water surface (does not feel
      "detached" from the waves).
- [ ] No visible caustics on geometry above the waterline (e.g. the
      rower's body, the deck).
- [ ] Disabled on `performanceMode === 'low'`.
- [ ] Build, lint, tests pass.
