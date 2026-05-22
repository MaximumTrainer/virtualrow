# Graphical Improvements – Proposed GitHub Issues

This folder contains a curated list of **graphical realism and rendering-performance** improvements
identified during a review of the 3D rendering code (primarily `src/components/Rower3D.tsx`,
`src/components/routeLandmarks/`, and the asset-generation scripts under `scripts/`).

Scope rules used during the review:
- **No in-game physics changes.** Stroke/boat/oar physics, force model, and rower kinematics are
  intentionally out of scope.
- **No route/course changes.** Route geometry, GPS path sampling, landmark placement logic, and
  route data are intentionally out of scope.
- **In scope:** rendering, shading, materials, lighting, post-processing, geometry tessellation,
  memoization, draw-call counts, LOD, asset filtering, and theme/colour pipelines.

Each file in this folder is a self-contained, ready-to-file GitHub issue. To file them, create a
new issue in this repository and copy the body of the corresponding `NN-*.md` file. They are
ordered roughly by expected impact / effort ratio (highest impact, lowest effort first).

## Index

### Performance (quick wins)
1. [`01-reduce-water-plane-tessellation.md`](./01-reduce-water-plane-tessellation.md) — Cut water plane from 128×128 to ~48×48 segments
2. [`02-remove-math-random-from-window-emissive.md`](./02-remove-math-random-from-window-emissive.md) — Replace `Math.random()` in JSX render with stable per-window state
3. [`03-set-canvas-dpr-cap.md`](./03-set-canvas-dpr-cap.md) — Cap `dpr` on `<Canvas>` for high-DPI / low-power modes
4. [`04-tone-down-postprocessing-on-low-power.md`](./04-tone-down-postprocessing-on-low-power.md) — Selectively disable DOF/Bloom/CA based on `performanceMode`
5. [`05-shadow-budget-for-distant-landscape.md`](./05-shadow-budget-for-distant-landscape.md) — Only `castShadow` on near-camera landscape elements
6. [`06-reduce-character-mesh-segments.md`](./06-reduce-character-mesh-segments.md) — Lower sphere segments on small rower body parts

### Performance (medium effort)
7. [`07-instance-or-merge-repeated-meshes.md`](./07-instance-or-merge-repeated-meshes.md) — Instance/merge gear teeth, windows, and tree foliage cones
8. [`08-consolidate-useframe-callbacks.md`](./08-consolidate-useframe-callbacks.md) — Consolidate per-component `useFrame` loops in scenery
9. [`09-share-material-instances-across-landscape.md`](./09-share-material-instances-across-landscape.md) — Reuse materials across landscape elements
10. [`10-add-distance-lod-for-landscape.md`](./10-add-distance-lod-for-landscape.md) — Add coarse LOD switching for trees / buildings far from the boat

### Realism
11. [`11-add-water-normal-map-detail.md`](./11-add-water-normal-map-detail.md) — Add tileable normal map on top of Gerstner waves
12. [`12-animated-foliage-wind-sway.md`](./12-animated-foliage-wind-sway.md) — Subtle vertex-shader sway for tree foliage
13. [`13-exponential-fog-and-theme-tuned-env-presets.md`](./13-exponential-fog-and-theme-tuned-env-presets.md) — Use `FogExp2` and theme-tuned environment presets
14. [`14-anisotropic-filtering-on-textured-materials.md`](./14-anisotropic-filtering-on-textured-materials.md) — Enable anisotropic filtering on distance textures

### Code-quality / maintainability (renders the rest easier)
15. [`15-centralise-rendering-config-and-theme-tables.md`](./15-centralise-rendering-config-and-theme-tables.md) — Extract magic numbers and theme palettes into config tables
16. [`16-deduplicate-water-config-and-extract-buildingmesh.md`](./16-deduplicate-water-config-and-extract-buildingmesh.md) — Share water-config helper; extract `<BuildingMesh>` sub-component

## Notes on methodology

Findings were verified by reading the cited lines in `src/components/Rower3D.tsx` directly. A few
candidates from the initial sweep were dropped because they overlapped with route/physics logic or
were already mitigated (e.g. the cube-camera reflection probe already throttles to every 30 frames).

None of the proposed changes alter:
- The rowing physics model
- Boat / oar movement equations
- Route or GPS path sampling
- Stroke detection or PM5 integration

They are strictly visual / rendering-pipeline improvements.
