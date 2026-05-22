## Title
Refactor: deduplicate water config and extract `<BuildingMesh>` sub-component

## Labels
`refactor`, `graphics`, `tech-debt`

## Summary
Two specific readability cleanups that make the rest of the graphics roadmap safer:

1. **Water config duplication.** `PhotorealisticWater` and `CurvedWaterChannel` each declare a near-identical theme-driven config object. Drift between the two has happened and will happen again. Extracting a `getWaterConfig(theme)` helper means changes apply once.
2. **Building JSX tree.** Per-building rendering is ~75 lines of deeply nested JSX inside a `switch` arm. Pulling it out into `<BuildingMesh type={...} scale={...} colors={...} />` makes per-type customisation (windows, frames, themes) tractable and is a prerequisite for the LOD work in issue [#10](./10-add-distance-lod-for-landscape.md) and the material-sharing work in issue [#09](./09-share-material-instances-across-landscape.md).

## Evidence
- `src/components/Rower3D.tsx:478-565` — `PhotorealisticWater` config block.
- `src/components/Rower3D.tsx:757-820` — `CurvedWaterChannel` near-duplicate config block.
- `src/components/Rower3D.tsx:1387-1462` — long inline building JSX inside a switch case.

## Proposed approach
- Add `getWaterConfig(theme: RouteTheme): WaterConfig` (a pure function) and use it from both water components.
- Add `<BuildingMesh>` component, with props that capture the variant behaviour of the current `switch` arm. Replace the inline JSX with a call to it.
- No visual / behavioural change.

## Out of scope
- Physics / route logic. Behavioural changes are limited to "compute the same value, in one place".

## Acceptance criteria
- [ ] Single shared water config helper, used by both water components.
- [ ] `<BuildingMesh>` component encapsulates per-building JSX; the landscape switch case becomes one line.
- [ ] Bit-identical screenshot output vs. baseline.
