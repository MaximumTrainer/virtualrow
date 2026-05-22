## Title
Realism: planar reflection (Reflector) on the water surface for boat & sky reflection

## Labels
`realism`, `graphics`, `water`, `enhancement`

## Summary
The water material currently uses a `CubeCamera`-based environment map for
reflections. Cube reflections sample a *distant* environment and therefore
cannot show the boat, oars, or near-shore landmarks reflected on the water
right next to the hull — which is the most expected reflection in any
real photograph of a scull on flat water.

## Motivation
A planar reflection of the boat onto the water immediately doubles the
perceived detail of the scene and is a near-universal hallmark of
photo-real water in real-time renderers.

## Proposed change
- Add a `Reflector` (from `@react-three/drei`) or a custom `WebGLRenderTarget`
  + mirror-matrix pass attached to the water plane geometry.
- Render at half-resolution into the reflection target; sample with a
  blur radius that scales with water roughness so it remains "wet" not
  "polished metal".
- Combine with the existing Gerstner wave displacement: distort the
  reflection UV by the surface normal × a small factor (~0.02) so the
  reflection ripples with the waves.
- Gate by `performanceMode`:
  - `high`: full planar reflection of boat + near landmarks
  - `medium`: planar reflection of boat only, quarter-res
  - `low`: keep current cube-camera path only (composes with #81)

## Acceptance criteria
- [ ] The hull and oar shafts are visibly mirrored on the water beneath
      and beside the boat.
- [ ] The reflection ripples with the wave surface; it is not a perfect
      mirror.
- [ ] In `low` mode there is no additional render pass added.
- [ ] No double-rendering of post-processing effects (the reflection pass
      must not run the post chain).
- [ ] All checks (`npm run lint`, `npm run test -- --run`, `npm run build`)
      pass.
