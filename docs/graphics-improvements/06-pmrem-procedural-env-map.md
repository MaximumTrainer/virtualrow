## Title
Realism: generate PMREM environment map from the procedural skydome (replace static drei preset)

## Labels
`realism`, `graphics`, `lighting`, `enhancement`

## Summary
The scene uses `<Environment preset="city" | "sunset" | "dawn" | "night">`
from `@react-three/drei` for reflections. These are *static, off-the-shelf
HDRIs* that do not match the procedurally generated `PhotorealisticSkydome`
the scene actually shows. Result: the reflection on the water and on
metallic riggers shows a *different* sky than the one rendered behind the
boat — a subtle but persistent break in believability.

## Motivation
Generating the IBL environment map directly from the rendered skydome via
a `PMREMGenerator` makes reflections automatically consistent with theme,
time-of-day, sun direction, and any future skydome edits, with no extra
HDRI files to ship.

## Proposed change
- On scene mount (or when `routeTheme` changes), render the
  `PhotorealisticSkydome` shader into a `WebGLCubeRenderTarget` (size 256
  or 512), then run `THREE.PMREMGenerator.fromCubemap()` to produce a
  pre-filtered environment.
- Set `scene.environment` to the resulting texture; drop the
  `<Environment preset=...>` component.
- Cache per `routeTheme`; only re-bake if theme or sun direction changes.

## Acceptance criteria
- [ ] Reflections on the boat's metallic riggers match the sky colour in
      every theme (cool blue in `gothic-venice`, golden in
      `steampunk-henley`, etc.).
- [ ] No more dependency on the `city` / `sunset` / `dawn` / `night` drei
      preset HDRIs in `Rower3D.tsx`.
- [ ] No measurable frame-time regression in steady state (the bake runs
      once per theme change).
- [ ] Bake is skipped under `__PLAYWRIGHT_TESTING` (consistent with the
      existing test-mode pattern documented in the repo memory).
- [ ] All checks pass.
