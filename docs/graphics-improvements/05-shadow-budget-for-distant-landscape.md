## Title
Perf: only `castShadow` on landscape elements near the boat

## Labels
`performance`, `graphics`

## Summary
Every landscape element (trees, buildings, banks, gear teeth, etc.) currently enables `castShadow`/`receiveShadow`. Shadow mapping cost scales with the number of shadow-casting meshes per shadow-map render. Most landscape geometry is far from the camera and out of the shadow camera's useful frustum; its contribution to the final image is negligible but it still inflates the shadow-pass draw count.

## Evidence
- `src/components/Rower3D.tsx:1258-1465` — landscape tree / building meshes set `castShadow`.
- `src/components/Rower3D.tsx:2507-2584` — terrain/bank meshes set shadow flags.
- `src/components/Rower3D.tsx:1441` — even back-facing windows of distant buildings cast shadows.

## Proposed approach
- Compute "near boat" for an element using `Math.abs(elementProgress - boatProgress) < ~0.05` (or distance in world units).
- Toggle `castShadow` only for near elements; keep `receiveShadow` on the broad water/bank surfaces.
- Optionally tune `directionalLight.shadow.camera` frustum to match the near-band so culling does the rest.

## Out of scope
- Physics / route logic. Element placement and route geometry are unchanged.

## Acceptance criteria
- [ ] Shadow-casting limited to a configurable near-band of landscape elements.
- [ ] Visual regression for the foreground scene is imperceptible.
- [ ] Measurable improvement in shadow-pass time (e.g. via Spector.js or browser profiling).
