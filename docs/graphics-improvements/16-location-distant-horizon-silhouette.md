## Title
Realism: per-theme distant skyline / mountain / horizon silhouette layer

## Labels
`realism`, `graphics`, `atmosphere`, `theming`, `enhancement`

## Summary
Beyond the immediate banks, the scene fades into fog with no distant
silhouette. Real rowing locations almost always have a recognisable
far-horizon shape: the Julian Alps behind Bled, the city skyline of
Boston, the Henley hills, the Chilterns / industrial Thames Estuary
chimneys, Venice's distant lagoon islands.

## Motivation
A baked far-horizon silhouette card (or a low-poly distant ring)
costs near zero per frame and immediately tells the viewer *where on
Earth* this is. It composes with #108 FogExp2 for aerial perspective.

## Proposed change
- Add a `<DistantHorizon theme={routeTheme} />` component that places
  a single large cylindrical billboard (~5 km radius) around the
  camera with a baked, theme-specific silhouette + atmospheric tint:
  - **willowbrook**: rolling pastoral hills, hedgerows, a distant
    church spire
  - **crystal-bled**: jagged Julian Alps with snow caps and the
    distinctive Triglav peak
  - **gothic-venice**: low silhouette of the lagoon — distant
    San Giorgio Maggiore, San Marco campanile
  - **steampunk-henley**: Chiltern hills with airship silhouettes
    drifting at staggered depths (parallax)
  - **dystopian-thames**: half-collapsed silhouettes of Battersea
    Power Station, broken Shard, oil-refinery chimneys with flame
    plumes
  - **scifi-boston**: layered megastructure skyline with animated
    aircraft running-lights and rooftop holograms
- Tint the silhouette by current `LIGHTING_PROFILE.aerosolDensity` so
  it matches the local fog colour automatically (composes with #108
  and #11).
- Optional second silhouette ring at ~2 km for a parallax mid-layer
  (only on `high`).

## Acceptance criteria
- [ ] Each theme shows a clearly distinct, recognisable far-horizon
      silhouette behind any closer scenery.
- [ ] The silhouette tints automatically with theme aerosol/fog
      colour — no per-silhouette tint hack.
- [ ] No additional draw calls beyond 1 (or 2 on `high`).
- [ ] Disabled in low mode does not visibly break the scene (fog
      hides the gap).
- [ ] All checks pass.
