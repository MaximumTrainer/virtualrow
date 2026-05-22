## Title
Realism: location-correct architecture kit (buildings, bridges, walls) per route theme

## Labels
`realism`, `graphics`, `architecture`, `theming`, `enhancement`

## Summary
Buildings today are mostly generic boxes with window grids and a couple
of theme-tinted variants. The result: Venice, Henley, and Boston all
have the same building silhouette outline at distance, which collapses
the sense of place.

## Motivation
Architectural silhouette is the single most powerful long-range
location cue — you recognise the Houses of Parliament, a Venetian
palazzo, or a Boston skyscraper from a kilometre away by shape alone,
long before any texture detail is visible.

## Proposed change
Introduce a per-theme architecture kit
(`src/three/architecture/buildingKits.ts`) with mesh + material
presets per theme:

- **willowbrook**: thatched/tile-roof cottages, small Anglican church
  spire, wooden boathouse, stone weir.
- **crystal-bled**: alpine pension chalets with steep gables and dark
  wood balconies; the iconic Pilgrimage Church on Bled Island silhouette
  on a mid-channel island; stone castle on a clifftop.
- **gothic-venice**: ogee-arched palazzi with belt courses, brick
  campaniles, footbridges over side canals, gothic tracery windows,
  weathered stucco textures with rising-damp staining.
- **steampunk-henley**: Edwardian regatta tents (white striped), brick
  riverside pubs, brass-and-rivet machinery on the banks (steam
  cranes, boilers), wrought-iron railings, Henley Bridge stone arches.
- **dystopian-thames**: crumbling concrete brutalism, collapsed
  warehouses, broken Hammersmith-style suspension bridge stubs, rusted
  gantry cranes, graffitied embankment walls.
- **scifi-boston**: tall glass-and-steel towers with animated emissive
  window grids (composes with #97 stable emissives), holographic
  advertisements above rooftops, suspended skyway bridges, neon
  underpass arches.

Implementation notes:
- Each kit is a small library of meshes loaded as a single GLB per
  theme (similar pattern to `public/models/virtualrow-environment.glb`,
  see scripts/generate-environment-assets.cjs).
- A `placeArchitecture(theme, route)` placement function distributes
  buildings along banks with theme-appropriate density (Henley: sparse
  cottages then a town; Boston: continuous skyline; Bled: a single
  iconic island church).
- Each theme defines 1–2 hero landmarks per route (Bled island church,
  Henley Bridge, Big-Ben-style clock tower on Thames, Venice campanile,
  Boston signature tower). These compose with #113 routeLandmarks.

## Acceptance criteria
- [ ] Each theme has at least 4 distinct building/wall mesh types.
- [ ] The skyline silhouette is theme-identifiable in a thumbnail at
      256×144 px.
- [ ] No building mesh from one theme appears in another (unit-tested
      against the kit → theme allow-list).
- [ ] At least one signature hero landmark per theme is visible during
      a default route.
- [ ] Total building draw calls ≤ 24 per scene (use instancing).
- [ ] All checks pass.
