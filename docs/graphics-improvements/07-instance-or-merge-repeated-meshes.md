## Title
Perf: instance or merge repeated meshes (gear teeth, building windows, tree cone layers)

## Labels
`performance`, `graphics`

## Summary
Several scenery features render many near-identical meshes in tight `.map()` loops:
- **Gear teeth** – 12 separate `boxGeometry` meshes per gear in the SteampunkHenley landscape.
- **Building windows** – several rows × columns of small box meshes per building.
- **Tree foliage** – 5 stacked cone layers per tree.

Each one is its own draw call and own JS object. Combining them via `InstancedMesh` (or by merging buffer geometries at build time) collapses tens of draw calls per object into a single one, with no visual change.

## Evidence
- `src/components/Rower3D.tsx:2106-2127` — per-tooth `boxGeometry` meshes for steampunk gears.
- `src/components/Rower3D.tsx:1387-1462` — per-window inline mesh tree for buildings.
- `src/components/Rower3D.tsx:1289-1327` — stacked cone layers per tree.

## Proposed approach
- Convert each `[...Array(N)].map(...)` of identical-material sub-meshes to a single `<instancedMesh>` with N instance matrices.
- Where geometry layout is genuinely heterogeneous, prefer `BufferGeometryUtils.mergeGeometries` at memo time.
- Keep transforms data-driven so future tuning doesn't require touching the renderer.

## Out of scope
- Physics / route logic. Scenery placement and route geometry are unchanged.

## Acceptance criteria
- [ ] Gear teeth, building windows, and tree foliage cones are rendered via `InstancedMesh` or merged geometry.
- [ ] Draw-call count (visible in `r3f`'s `gl.info`) drops noticeably on routes that include these elements.
- [ ] No visual regression vs. baseline screenshot.
