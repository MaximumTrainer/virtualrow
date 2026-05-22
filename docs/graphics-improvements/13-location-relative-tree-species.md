## Title
Realism: diverse, location-correct tree species library (instanced) per route theme

## Labels
`realism`, `graphics`, `flora`, `theming`, `enhancement`

## Summary
The current bank vegetation uses generic stylised "cone" trees swapped
by colour per theme. Every location ends up with the same silhouette —
which is the single strongest tell that this is procedural CG, not a
real riverbank.

## Motivation
Real rivers are silhouetted by recognisable tree species. Putting the
*right* tree in the *right* place ("oh, that's a London plane along
the Thames") is what makes the location feel placed, not generated.

## Proposed change
Introduce a tree species library
(`src/three/flora/treeSpecies.ts`) where each species is a baked
low-poly mesh + canopy alpha-billboard atlas (so distant trees can
swap to billboard impostors, composing with #105):

| Theme              | Primary species                         | Secondary                    |
|--------------------|-----------------------------------------|------------------------------|
| willowbrook        | weeping willow, English oak             | silver birch, alder          |
| crystal-bled       | Norway spruce, larch, beech             | mountain pine                |
| gothic-venice      | Italian cypress, umbrella pine, olive   | dead/blackened lone trees    |
| steampunk-henley   | London plane, beech, horse chestnut     | mature willow                |
| dystopian-thames   | leafless deciduous (oak/plane skeletons), dead conifers | sickly yellow-leafed survivors |
| scifi-boston       | engineered geometric trees, neon-lit ginkgos | bare urban planters         |

Implementation notes:
- Each species ships as one `THREE.InstancedMesh` (trunk) +
  one `THREE.InstancedMesh` (canopy) so populating a bank with 200
  mixed trees stays at ~12 draw calls total.
- Author canopies with translucent alpha-tested foliage cards and
  subsurface tint so backlight reads correctly (composes with #107
  foliage sway).
- A `placeTrees(theme, banks)` function distributes species with
  per-theme blue-noise weights (e.g. Henley: 60% plane, 30% beech,
  10% chestnut) so distribution feels natural, not gridded.
- Cluster species: rare/dead individuals appear in Thames; cypresses
  appear in vertical groups along Venice canal banks; willows lean
  toward the water at Willowbrook.

## Acceptance criteria
- [ ] At least 3 distinct tree species are visible in each themed
      scene (5+ in willowbrook/henley).
- [ ] No species appears in a theme where it doesn't belong (verified
      by a unit test against the species → theme allow-list).
- [ ] Total tree draw calls per scene ≤ 16.
- [ ] Trees fade smoothly to billboard impostors beyond ~120 m and to
      nothing beyond ~300 m.
- [ ] All checks pass.
