## Title
Realism: per-theme color-grading LUT (LookupTextureEffect) for cinematic look

## Labels
`realism`, `graphics`, `post-processing`, `theming`, `enhancement`

## Summary
Theme differentiation today comes from light colour, fog colour, and a
few palette swaps. The output already passes through ACES tone mapping,
but there is no per-theme colour grade. As a result `default` and
`steampunk-henley` look identical in mid-tones even though the
*lighting* differs — the underlying material colours are the same.

## Motivation
A single 32³ LUT applied as the final post-processing pass is the
industry-standard way to give each environment a distinct emotional
register (cool teal-and-orange, sepia, cyberpunk magenta, etc.) without
re-authoring any materials. It is fast (one texture sample per pixel)
and trivially gated.

## Proposed change
- Add `LUTPass` / `LookupTextureEffect` from `postprocessing` as the
  final pass in the `EffectComposer` chain (after `ToneMapping`).
- Ship one 32³ `.cube` or `.png` LUT per theme, stored under
  `public/luts/`:
  - `default-natural.cube`
  - `dystopian-thames-sepia.cube`
  - `gothic-venice-cool.cube`
  - `steampunk-henley-warm.cube`
  - `scifi-boston-neon.cube`
- Cross-fade the LUT texture when `routeTheme` changes (1 s fade).
- Document the LUT authoring workflow (e.g. exported from DaVinci
  Resolve or Photoshop) in this directory's README.

## Acceptance criteria
- [ ] Each theme has a clearly distinct overall colour cast in
      screenshots even with identical scene geometry.
- [ ] LUT texture loads asynchronously and does not block first frame.
- [ ] Disabling LUT (e.g. `performanceMode === 'low'`) yields the
      current ACES-only look unchanged.
- [ ] LUT files are ≤256 KB each (PNG-packed 32³).
- [ ] All checks pass.
