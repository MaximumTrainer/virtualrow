## Title
Realism: use `FogExp2` and theme-tuned environment presets

## Labels
`graphics`, `realism`

## Summary
Two related atmospheric tweaks that meaningfully improve theme cohesion:

1. **Exponential fog.** The current scene uses linear fog, which produces a hard fog band rather than a smooth depth falloff. `THREE.FogExp2` reads more naturally for outdoor scenes and reduces the visibility of the far clipping plane.
2. **Theme-tuned environment presets.** The default environment IBL appears to be `'city'` regardless of theme. Themes like Gothic Venice, Sci-Fi Boston, and SteampunkHenley would each benefit from a distinct preset (`'dawn'`, `'night'`, `'sunset'`, etc.), because the environment map drives reflections on water, the boat hull, and any metallic landscape.

## Evidence
- `src/components/Rower3D.tsx:3843` — linear fog attachment.
- `src/components/Rower3D.tsx:3921-3932` — environment preset selection.

## Proposed approach
- Replace linear fog with `scene.fog = new THREE.FogExp2(color, density)` where `density` is part of the per-theme config table (see issue [#15](./15-centralise-rendering-config-and-theme-tables.md)).
- Add a `Record<RouteTheme, EnvironmentPreset>` map and select the preset from it.
- Verify each theme visually via Playwright docs screenshots.

## Out of scope
- Route / physics logic.

## Acceptance criteria
- [ ] Fog uses `FogExp2` and density is per-theme.
- [ ] Each theme uses an explicit environment preset.
- [ ] Screenshots refreshed and visually approved.
