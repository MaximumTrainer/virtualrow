# Scenery Assets

3D models for dressing rownative courses, built from the specifications in
[issue #216](https://github.com/MaximumTrainer/virtualrow/issues/216) using
[llm-cad](https://github.com/MaximumTrainer/llm-cad).

**All 114 models complete** — Tier **A** (12), **B** (8), **C** (8), **D** (25),
**E** (14), **F** (47). This is the full de-duplicated model set from #216; the
hero landmark register in the appendices is a separate one-off effort.

## Directory layout

```
scenery/
  tier-a/   Universal rowing furniture (12) — every venue
  tier-b/   Water-edge structures (8) — boathouses, clubhouse, rack, quay, wharf, crane, marina
  tier-c/   Crossings (8) — arch, concrete, truss, girder, bascule, suspension, lift, cantilever
  tier-d/   Regional architecture kits (25) — US / GB / NL / CE / IT
  tier-e/   Vegetation (14) — stylized low-poly trees, reeds, ground
  tier-f/   Generic biome kit (47) — bank edges, landform, scatter, water, infra, backdrop
  tier-g/   Additional archetypes (12) — skyscraper, bridges, dam, lighthouse, windmotor, towers, islet
  tier-l/   Liveried landmark heroes (3) — Barnes, Fremont, Ponte Isabella
  (../boat/) Tier H crew & craft — scull.glb, scull-male.glb, scull-female.glb
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

### Tier B — water-edge structures (8)
`b01` New England boathouse · `b02` UK Victorian boathouse · `b03` modern clubhouse ·
`b04` outdoor boat rack · `b05` stone quay wall · `b06` wharf warehouse ·
`b07` luffing quay crane · `b08` marina pontoon cluster

### Tier C — crossings (8)
`c01` masonry arch · `c02` concrete beam · `c03` steel through-truss ·
`c04` plate-girder rail · `c05` bascule · `c06` foot suspension ·
`c07` Dutch lift (ophaalbrug) · `c08` steel cantilever

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

### Tier F — generic biome kit (47)
- **F1 bank edges** (9): `f01` earth-cut · `f02` shingle shelf · `f03` reed margin · `f04` masonry wall · `f05` sheet piling · `f06` sand shelf · `f07` boulder shore · `f08` pile revetment · `f09` concrete step
- **F2 landform** (8): `f10` rolling meadow · `f11` wooded hillside · `f12` steep bluff · `f13` cliff face · `f14` polder flat · `f15` mid-channel sandbank · `f16` wooded island · `f17` tidal mudflat
- **F3 ground scatter** (9): `f18` grass tuft · `f19` flower patch · `f20` reed stand · `f21` boulder cluster · `f22` shingle scatter · `f23` driftwood log · `f24` deadfall pile · `f25` bramble scrub · `f26` fern clump
- **F4 water surface** (6): `f27` lily-pad raft · `f28` weed mat · `f29` weed streamer · `f30` foam line · `f31` moored dinghy · `f32` moored cruiser
- **F5 infrastructure** (12): `f33` post-rail fence · `f34` wire stock fence · `f35` hedgerow · `f36` towpath · `f37` park bench · `f38` lamp post · `f39` litter bin · `f40` pylon · `f41` telegraph pole · `f42` culvert outfall · `f43` mooring bollard · `f44` navigation marker
- **F6 distant backdrop** (3): `f45` treeline strip · `f46` far hill ridge · `f47` town skyline

## Wiring into the scene

The GLBs are wired to the enrichment enums the scene already produces:

- `src/components/rower3d/sceneryAssets.ts` — the **selection logic**: maps
  `SceneryProfile` and `WaterBodyType` to model ids (the issue's selection
  matrix), plus `resolveSceneryModels()` / `collectSceneryPaths()` and the
  `isGlbSceneryEnabled()` flag. Pure and unit-tested
  (`src/__tests__/sceneryAssets.test.ts`).
- `src/components/rower3d/sceneryModels.tsx` — `SceneryModels`, which loads the
  resolved GLBs with drei `useGLTF` and places cloned instances along the route
  curve (per-segment profile) or in bands on the flat path.
- `src/components/Rower3D.tsx` — renders `SceneryModels` on the default
  (`willowbrook`) theme, inside a `<Suspense>` boundary.

**Opt-in for now.** These models are un-decimated and add draw calls to an
already heavy post-processed scene, which can exhaust the WebGL context, so the
kit is gated behind a flag (default off): add `?glb=1` to the URL or set
`window.__VIRTUALROW_SCENERY_MODELS = true`. Turning it on by default is a
follow-up once the `_lod2` variants from the issue are generated and the draw
cost is validated on target hardware.

## Regenerating

Models are generated from `scripts/build_scenery.py` (CadQuery via llm-cad).
Run against the local llm-cad environment:

```
uv run python scripts/build_scenery.py public/assets/scenery
```
