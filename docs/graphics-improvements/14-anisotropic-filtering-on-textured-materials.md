## Title
Realism: enable anisotropic filtering on distance textures

## Labels
`graphics`, `realism`, `good first issue`

## Summary
Any texture viewed at a glancing angle — banks, terrain, future water normal map (issue [#11](./11-add-water-normal-map-detail.md)) — benefits from anisotropic filtering. Without it, distant surfaces look smudged or shimmer when the camera moves. The cost is essentially free on modern GPUs; the win is "looks crisp" at glancing angles.

## Evidence
- All textured materials in `src/components/Rower3D.tsx` (e.g. terrain/bank materials around lines 1098-1107 and 2395-2401) — none set `texture.anisotropy`.

## Proposed approach
- In `<Canvas onCreated={({gl}) => ...}>`, read `gl.capabilities.getMaxAnisotropy()` once and store it in a ref.
- On every texture load (loader callback or `useLoader`), assign `texture.anisotropy = maxAnisotropy` before first render.
- Optionally clamp to `8` on low-power mode.

## Out of scope
- Physics / route logic.

## Acceptance criteria
- [ ] All loaded textures have `anisotropy` set explicitly.
- [ ] Glancing-angle screenshots show crisper textures.
