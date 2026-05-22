## Title
Realism: PBR texture maps (roughness / normal / clearcoat) on boat hull and oar blades

## Labels
`realism`, `graphics`, `materials`, `enhancement`

## Summary
The single scull hull, riggers, and oar blades currently use untextured
`MeshStandardMaterial` instances tuned only via flat `color` / `roughness` /
`metalness` scalars. Real composite/carbon hulls and varnished blades have
strong micro-detail (weave pattern, brushed varnish, water beading, edge
wear) that is the single largest contributor to "this looks CG" vs. "this
looks photographed" in close-up shots of the boat.

## Motivation
The boat is the focal element of the entire scene — it occupies the centre of
the camera frustum the whole workout. Investing in PBR texturing on this one
asset has a higher realism-per-byte ratio than any environment improvement.

## Proposed change
- Author or source CC0 PBR texture sets (basecolor / normal / roughness /
  metalness / ambient occlusion) for:
  - Carbon-weave hull shell
  - Painted/varnished deck stripe
  - Brushed-aluminium rigger arms
  - Oar shaft (carbon) and blade (painted faces, contrasting tip)
- Bake them into the `scripts/generate-scull-model.cjs` GLB export so the
  textures travel with `public/models/scull.glb` (existing convention — see
  the repository memory on `node scripts/generate-scull-model.cjs`).
- Add a `clearcoat: 1.0` / `clearcoatRoughness: 0.1` layer (or switch the
  hull material to `MeshPhysicalMaterial`) to capture the wet-varnish
  highlight pass.
- Wire texture mipmaps and `anisotropy = renderer.capabilities.getMaxAnisotropy()`
  (composes with #109).

## Acceptance criteria
- [ ] Hull, riggers, and oar blades use `MeshPhysicalMaterial` with at least
      basecolor + normal + roughness maps embedded in the exported GLB.
- [ ] Clearcoat is visible as a tight specular streak under the directional
      light in the default theme.
- [ ] No regression in `npm run test -- --run`, `npm run build`, or the
      Playwright docs screenshot test.
- [ ] GLB size delta is documented in the PR description; if it exceeds
      ~2 MB, textures are downscaled or BC7/KTX2 compressed via a follow-up.

## Out of scope
- Generating textures for landscape props (handled by #104 / future issues).
- Animating the wet-shine response to spray (see foam/spray proposal).
