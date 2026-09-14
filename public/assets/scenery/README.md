# Scenery Assets

3D models for dressing rownative courses, built from the specifications in
[issue #216](https://github.com/MaximumTrainer/virtualrow/issues/216) using
[llm-cad](https://github.com/MaximumTrainer/llm-cad).

**27 of 114 models** — the full "build first" slice (steps 1–5 of the issue's
build order): all of Tier A, the three boathouse types, the two commonest
bridges, the four commonest bank edges, and the priority ground scatter.

## Directory layout

```
scenery/
  tier-a/   Universal rowing furniture (12) — every venue
  tier-b/   Water-edge structures (3) — boathouses / clubhouses
  tier-c/   Crossings (2) — bridges
  tier-d/   Regional architecture kits (future batches)
  tier-e/   Vegetation (future batches)
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
