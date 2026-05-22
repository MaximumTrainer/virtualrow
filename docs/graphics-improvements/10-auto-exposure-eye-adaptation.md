## Title
Realism: auto-exposure / eye-adaptation so themes feel consistent across bright and dark scenes

## Labels
`realism`, `graphics`, `post-processing`, `tonemapping`, `enhancement`

## Summary
`toneMappingExposure` is hard-coded to `1.0` and `environmentIntensity`
is driven by a fixed `skyConfig.exposure`. The result: `scifi-boston`
(a night scene) feels noticeably dimmer than `steampunk-henley` (a
golden-hour scene) on the same monitor — not because the *scene* is
darker (a real eye/camera would adapt) but because the *renderer*
exposes it darker.

## Motivation
Adding eye-adaptation gives every theme a consistent perceived
brightness while still letting the *colour* tell the time-of-day
story. It also removes the need to hand-tune exposure per theme.

## Proposed change
- Use `postprocessing`'s `ToneMappingEffect` with
  `ToneMappingMode.ACES_FILMIC` (already in use) plus its
  `adaptive: true` option, or implement a manual luminance histogram
  pass that exponentially smooths exposure toward a target average
  luminance.
- Adaptation rate: ~0.5 s for theme changes (we already know when the
  theme switches and can pre-set the target), ~3 s for natural
  in-theme changes (e.g. boat entering a tunnel).
- Clamp `toneMappingExposure` to `[0.4, 2.0]` so we never fully blow
  out highlights or crush blacks.

## Acceptance criteria
- [ ] Average screen luminance measured from the Playwright screenshot
      test stays within ±15% across all five themes at the default
      camera position.
- [ ] Switching `routeTheme` produces a smooth ~0.5 s exposure ramp,
      not an instant pop.
- [ ] Tunnels / strong shadow regions briefly brighten over ~3 s
      (verifiable with a manual playthrough).
- [ ] No oscillation / pulsing artefact when looking at the water at
      steady state.
- [ ] All checks pass.
