## Title
Perf: share material instances across landscape elements

## Labels
`performance`, `graphics`

## Summary
Landscape rendering creates a fresh `meshPhysicalMaterial` / `meshStandardMaterial` for every tree trunk, foliage layer, wall panel, etc., inside the render. With ~50–100 landscape elements per route this means dozens of redundant material instances and possible shader-program permutations even though they share parameters. Sharing one material per "kind" reduces GPU state changes and uploads.

## Evidence
- `src/components/Rower3D.tsx:1260-1268` — per-element trunk material declared inline inside the map.
- Building / window / bank renderers follow the same pattern.

## Proposed approach
- In each `landscape*` renderer, build a small palette of materials in `useMemo` (e.g. `{ trunk, foliage, brick, glass }`) keyed by theme.
- Replace inline `<meshPhysicalMaterial ...>` with `<primitive object={palette.trunk} attach="material" />` (or assign material refs).
- Ensure materials are disposed in the same `useEffect` cleanup as their owning memo.

## Out of scope
- Physics / route logic.
- Material *look* (colours, roughness, etc.) — keep visually identical.

## Acceptance criteria
- [ ] Per-kind material instances are reused across landscape elements.
- [ ] `gl.info.programs` / `gl.info.memory.materials` does not grow with element count.
- [ ] No visual regression vs baseline screenshot.
