## Title
Perf/Realism: add distance LOD for trees and buildings

## Labels
`performance`, `graphics`

## Summary
Landscape elements use full detail (5-layer cone foliage, multi-window buildings, gear teeth) regardless of distance from the camera. Far-from-camera elements contribute only a few pixels but pay full vertex/material cost. A coarse LOD switch — even just two levels (near vs. far) — would dramatically cut work without changing element placement.

## Evidence
- `src/components/Rower3D.tsx:1252-1465` — landscape element renderer always uses full detail.
- `src/components/Rower3D.tsx:1289-1327` — 5 stacked cones per tree foliage.

## Proposed approach
- Define `LOD0` (current) and `LOD1` (cheap) variants for each element type:
  - Tree LOD1: single cone + trunk; no leaf-detail micro layers.
  - Building LOD1: single box, no per-window meshes.
  - Gear LOD1: single torus/cylinder, no individual teeth.
- Pick LOD using distance along the route or world distance to camera; switch threshold should be conservative (e.g. > 30 world units).
- LOD switching must be purely visual; **placement, count, and route geometry stay identical.**

## Out of scope
- Physics / route logic. No landmark removed, repositioned, or merged.

## Acceptance criteria
- [ ] Each landscape element type has at least two LODs.
- [ ] Distant element groups demonstrably issue fewer draw calls.
- [ ] No visible pop-in at expected camera distances (use a wide fade-in or pick the cutover well outside the foreground zone).
