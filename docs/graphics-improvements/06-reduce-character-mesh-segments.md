## Title
Perf: lower sphere segment counts on small rower body parts

## Labels
`performance`, `graphics`, `good first issue`

## Summary
The rower character's small body parts use unnecessarily dense `sphereGeometry`. The head is a ~10cm sphere with `24×24` segments (576 vertices), far above what any reasonable on-screen size requires. Hands and eyes are similarly over-tessellated. Reducing segment counts on small spheres is risk-free and saves tens of thousands of vertices across the rower rig over time.

## Evidence
- `src/components/Rower3D.tsx:3118` — `sphereGeometry args={[0.1, 24, 24]}` for the head.
- Other small sphere geometries on the rower (hands, eyes) follow the same pattern; audit during implementation.

## Proposed approach
- Audit all `sphereGeometry` calls in `Rower3D.tsx` for radius < 0.2.
- Drop segment counts to `12×12` for objects up to ~10cm radius and `8×8` for eye-scale objects.

## Out of scope
- Physics / route logic. Rower kinematics are unchanged.

## Acceptance criteria
- [ ] All small sphere geometries on the rower use ≤ 12×12 segments.
- [ ] No visible silhouette change at default camera distance.
