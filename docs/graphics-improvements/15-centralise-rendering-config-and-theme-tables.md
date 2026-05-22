## Title
Refactor: centralise rendering config and per-theme palette tables

## Labels
`refactor`, `graphics`, `tech-debt`

## Summary
Tuning numbers and theme colours are scattered inline throughout `Rower3D.tsx`. This makes performance tuning (water tessellation, shadow map size, bloom threshold, fog density) and theme work (hemisphere/ambient/directional colours per theme) high-friction and error-prone. Centralising them into a couple of typed tables unlocks several of the other issues in this folder.

## Evidence
- `src/components/Rower3D.tsx:142` — `WATER_CHANNEL_WIDTH = 20` (and similar magic numbers nearby).
- `src/components/Rower3D.tsx:602` — `128, 128` water segments inline.
- `src/components/Rower3D.tsx:3850-3880` — per-theme light colours hard-coded inline in JSX props.
- `src/components/Rower3D.tsx:3921-3932` — environment preset hard-coded.

## Proposed approach
- Add `src/components/Rower3D.config.ts` (or a top-of-file const block):
  - `RENDERING_CONFIG`: `{ waterTessellationHigh, waterTessellationLow, shadowMapSize, bloomLuminance, dprCap }`.
  - `THEME_CONFIG: Record<RouteTheme, { hemColor, ambientColor, dirColor, dirIntensity, fogColor, fogDensity, envPreset }>`.
- Refactor `Rower3D.tsx` to read from these tables. No behavioural change in this step.
- Subsequent issues (DOF gating, FogExp2, dpr cap, water tessellation) can then trivially read from the config.

## Out of scope
- Physics / route logic. No behaviour change in this issue — pure extraction.

## Acceptance criteria
- [ ] Numerical rendering tunables live in a single config object.
- [ ] Per-theme colours live in a single typed table.
- [ ] Existing rendering output is bit-identical to before the refactor (verified by docs screenshot diff).
