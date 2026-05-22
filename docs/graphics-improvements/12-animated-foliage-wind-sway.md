## Title
Realism: subtle vertex-shader sway on tree foliage

## Labels
`graphics`, `realism`

## Summary
All scenery trees are completely static. Adding a low-amplitude `sin(time + position)` displacement in the foliage material's `onBeforeCompile` injects a believable wind sway with minimal cost. This is one of the highest "looks alive" wins for outdoor 3D scenes and pairs well with the existing animated water and clouds.

## Evidence
- `src/components/Rower3D.tsx:1289-1327` — tree foliage cones are static meshes with no animation.

## Proposed approach
- In the shared foliage material (see issue [#09](./09-share-material-instances-across-landscape.md)) use `material.onBeforeCompile` to inject a vertex displacement of the form:
  `transformed.x += sin(uTime * freq + position.y * 8.0) * 0.05 * step(0.1, position.y);`
  (only sway upper vertices, leave the base anchored.)
- Drive `uTime` via the consolidated animation context from issue [#08](./08-consolidate-useframe-callbacks.md).
- Disable sway in low-power mode for safety.

## Out of scope
- Boat physics or route logic. No tree placement changes.

## Acceptance criteria
- [ ] Trees in the foreground exhibit gentle, theme-appropriate sway.
- [ ] Trunks remain visually anchored (no shearing at the base).
- [ ] No measurable frame-time regression.
