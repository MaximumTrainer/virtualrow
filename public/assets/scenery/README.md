# Scenery Assets

3D models for dressing rownative courses, built from the specifications in
[issue #216](https://github.com/MaximumTrainer/virtualrow/issues/216) using
[llm-cad](https://github.com/MaximumTrainer/llm-cad).

**66 of 114 models** — Tier A (12), Tier B (3), Tier C (2), Tier F (10), and now
the full **Tier D regional kits (25)** and **Tier E vegetation (14)**. Remaining:
additional Tier C crossings and Tier F infrastructure, plus the hero landmarks.

## Directory layout

```
scenery/
  tier-a/   Universal rowing furniture (12) — every venue
  tier-b/   Water-edge structures (3) — boathouses / clubhouses
  tier-c/   Crossings (2) — bridges
  tier-d/   Regional architecture kits (25) — US / GB / NL / CE / IT
  tier-e/   Vegetation (14) — stylized low-poly trees, reeds, ground
  tier-f/   Generic biome kit (10) — bank edges, scatter, infrastructure
  renders/  Multi-view coloured PNG previews of each model
```

## Conventions (per issue #216)

| Rule | Value |
|---|---|
| Units | mm in CadQuery; the importer scales mm → scene metres |
| Origin | Centred on X/Y, Z = 0 at waterline contact |
| Orientation | +Y faces the water |
| Colour | Per-face hex from the issue palette; **flat colour, no textures** — the scene lights it |
| Export | STEP master (colour-tagged) + GLB (colour-tagged, scene-ready) |
| Naming | `<tier><nn>-<slug>.{step,glb}` |

Each `.glb` carries the palette as glTF PBR `baseColorFactor` per part, so the
model drops into the Three.js scene (`useGLTF`) already coloured. No texture
maps: the issue specifies flat regional-material colours, lit by the scene.

## Real-world verification

Colours and proportions were checked against real references, not guessed:

- **Lane buoys** — Albano system: red at the start/finish zones, white through
  the middle. `a01` ships in the start/finish red (`#E8452B`); the scene swaps
  the same model to white for mid-course instances.
- **Umpire launch** — white hull is the real-world default; `a08` matches.
- **New England boathouse** — vernacular 2-storey clapboard club with river-
  facing balcony, wide boat-bay doors, and a ridge cupola (Riverside/BU type),
  in muted clapboard rather than the grand masonry (Newell/Weld) tradition.
- **Concrete beam bridge** — aged mid-grey with a plain parapet, not clean
  white; `c02` uses the issue's `#B0ACA4`.
- **Hexagonal gazebo, finish tower, stake boat** — proportions and muted/
  functional colours confirmed against regatta references.

## Models in this batch

### Tier A — rowing furniture (12)
`a01` lane buoy · `a02` turn buoy · `a03` floating dock · `a04` fixed launch dock ·
`a05` stakeboat platform · `a06` finish tower · `a07` distance marker ·
`a08` umpire launch · `a09` hexagonal gazebo · `a10` slipway ramp ·
`a11` bank railing · `a12` regatta flagpole

### Tier B — water-edge structures (3)
`b01` New England boathouse · `b02` UK Victorian boathouse · `b03` modern clubhouse

### Tier C — crossings (2)
`c01` masonry arch bridge · `c02` concrete beam bridge

### Tier D — regional architecture kits (25)
- **US** (6): clapboard house, brick mill, collegiate dome, collegiate tower, water tower, highway sign gantry
- **GB** (6): brick terrace, parish church, riverside pub, stone cottage, stone barn, regatta marquee
- **NL** (6): gabled canal house, polder windmill, stolp farmhouse, canal lock, wind turbine, reed bank edge
- **CE** (4): baroque onion church, panelák block, riverside villa, hydro weir house
- **IT** (3): Po palazzo, Castello del Valentino, arcaded embankment

### Tier E — vegetation (14)
`e01` London plane · `e02` weeping willow · `e03` Lombardy poplar · `e04` English oak ·
`e05` red maple · `e06` white birch · `e07` eastern white pine · `e08` Scots pine ·
`e09` alder scrub · `e10` Italian cypress · `e11` reed bed · `e12` pollarded willow ·
`e13` mown bank grass · `e14` autumn leaf litter

Trees are stylized low-poly (tapered trunk + coloured crown blobs), sized to the
species heights in #216 and kept boolean-free so they stay light for instancing.

### Tier F — generic biome kit (10)
`f01` earth-cut bank · `f02` shingle shelf · `f03` reed margin · `f04` masonry wall ·
`f18` grass tuft · `f20` reed stand · `f21` boulder cluster · `f25` bramble scrub ·
`f33` post-rail fence · `f37` park bench

## Regenerating

Models are generated from `scripts/build_scenery.py` (CadQuery via llm-cad).
Run against the local llm-cad environment:

```
uv run python scripts/build_scenery.py public/assets/scenery
```
