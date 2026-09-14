# Scenery Assets

3D models for dressing rownative courses, built from the specifications in
[issue #216](https://github.com/MaximumTrainer/virtualrow/issues/216) using
[llm-cad](https://github.com/MaximumTrainer/llm-cad).

## Directory layout

```
scenery/
  tier-a/   Universal rowing furniture (buoys, docks, towers, markers)
  tier-b/   Water-edge structures (boathouses, quay walls)
  tier-c/   Crossings (bridges)
  tier-d/   Regional architecture kits (empty — future batches)
  tier-e/   Vegetation (empty — future batches)
  tier-f/   Generic biome kit (bank edges, scatter, infrastructure)
  renders/  Multi-view PNG previews of each model
```

## Conventions

| Rule | Value |
|---|---|
| Units | mm in CadQuery; the importer scales mm → scene metres |
| Origin | Centred on X/Y, Z = 0 at waterline contact |
| Orientation | +Y faces the water |
| Export | STEP master + GLB for the scene |
| Naming | `<tier><nn>-<slug>.{step,glb}` |

## Models in this batch (14 of 114 total)

### Tier A — rowing furniture
- `a01-buoy-lane-sphere` — Spherical lane buoy, dia 300mm
- `a02-buoy-turn-cylinder` — Cylindrical turn marker, dia 600 × 900mm
- `a03-pontoon-floating-dock` — Modular floating dock, 6000 × 2400 × 450mm
- `a05-stakeboat-platform` — Start pontoon with bow-catcher, 3500 × 1400 × 800mm
- `a06-finish-tower` — Two-storey timing tower, 3000 × 3000 × 6500mm
- `a07-distance-marker-post` — Bank marker board, 900 × 60 × 2400mm
- `a11-bank-railing` — Tubular railing bay, 2400 × 60 × 1100mm
- `a12-regatta-flagpole` — Tapered flagpole with pennant, dia 120 × 8000mm

### Tier B — water-edge structures
- `b01-boathouse-new-england` — Two-storey shingled boathouse, 30000 × 14000 × 11000mm

### Tier C — crossings
- `c02-bridge-road-concrete` — Concrete beam bridge, 80000 × 14000 × 10000mm

### Tier F — generic biome kit
- `f18-grass-tuft-clump` — Grass tuft, 500 × 500 × 600mm
- `f21-boulder-cluster` — Three angular boulders, 1800 × 1400 × 900mm
- `f33-post-rail-fence` — Timber fence bay, 3000 × 100 × 1200mm
- `f37-park-bench` — Slatted bench, 1800 × 600 × 900mm
