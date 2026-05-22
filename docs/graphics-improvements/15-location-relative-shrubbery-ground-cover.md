## Title
Realism: location-correct shrubbery and ground-cover variety (reeds, ferns, ivy, debris)

## Labels
`realism`, `graphics`, `flora`, `theming`, `enhancement`

## Summary
The bank-line currently has trees and grass and almost nothing in
between — no reeds at the water's edge, no shrubs at mid-height, no
ground cover, no rocks. The transition from water to tree canopy is
abrupt and reads as procedural. Real banks have a continuous *vertical
gradient* of vegetation: emergent reeds → low shrubs → mid bushes →
tree understorey → canopy.

## Motivation
Adding even a thin layer of mid-height shrubbery and ground cover —
correctly themed per location — closes the biggest visible "void" in
the scene and pushes realism more than any single hero mesh.

## Proposed change
Introduce a shrubbery / ground-cover library
(`src/three/flora/shrubs.ts`) using `InstancedMesh` for density and
alpha-tested cards for variety. Each entry is keyed by theme:

| Theme              | Emergent (water edge)         | Low shrubs / midstorey                  | Ground cover                              |
|--------------------|-------------------------------|-----------------------------------------|-------------------------------------------|
| willowbrook        | bulrush, common reed, yellow iris | hawthorn, dog rose, elder              | long meadow grass, buttercups, daisies    |
| crystal-bled       | sparse sedge                   | juniper, bilberry, alpine rhododendron | alpine moss, gentian, edelweiss patches   |
| gothic-venice      | none (sea-walls)               | thorny acanthus, dried sage              | cracked-paving moss, ivy on stone walls   |
| steampunk-henley   | reedmace, water forget-me-not | regatta hedgerows, boxwood              | manicured lawn, daisies, dropped programmes |
| dystopian-thames   | dead reed stubs, plastic-tangled grass | brambles, ragwort, buddleia colonising rubble | dust, broken glass, sickly weeds        |
| scifi-boston       | bioluminescent moss patches   | engineered topiary, neon-lit planters   | concrete with crack-line LED strips, holo-grass |

Implementation notes:
- All entries are instanced quad billboards with alpha-tested textures
  + a tiny normal map; one draw call per entry per chunk.
- Add a thin band of *emergent* vegetation (~0.5 m wide, ~0.3 m tall)
  along the water-edge polyline of every bank, except in themes where
  it shouldn't exist (Venice walls, Bled stone shore).
- Ground cover uses a `RawShaderMaterial` with cheap per-instance
  colour jitter so a thousand grass cards don't look identical.
- Density scales by `performanceMode`: `high` ~400 instances per
  20 m chunk; `medium` ~150; `low` 0.

## Acceptance criteria
- [ ] In willowbrook and henley, reeds are visible along the water's
      edge.
- [ ] Venice has visible ivy on canal walls but no reeds.
- [ ] Thames has visible buddleia / brambles growing through cracks.
- [ ] Bled has alpine flowers / moss visible on shore stones.
- [ ] No shrub from one theme appears in another (unit-tested against
      the table → theme allow-list).
- [ ] No frame-time regression > 1 ms on `medium` at 1080p.
- [ ] All checks pass.
