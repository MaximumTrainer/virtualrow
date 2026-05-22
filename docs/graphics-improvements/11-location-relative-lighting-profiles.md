## Title
Realism: location-relative lighting profiles (sun elevation, weather, sky scattering) per route theme

## Labels
`realism`, `graphics`, `lighting`, `theming`, `enhancement`

## Summary
Lighting today is defined inline in `src/components/Rower3D.tsx` as a
collection of nested ternaries on `routeTheme`. The six themes
(`willowbrook`, `crystal-bled`, `gothic-venice`, `steampunk-henley`,
`dystopian-thames`, `scifi-boston`) share the same lighting *structure* —
one directional + one fill + one ambient + one hemisphere — and only
differ in colour and intensity. This makes every location feel like the
same studio with a gel over the lights, not like a different place.

## Motivation
Real locations differ in *atmosphere*, not just in sun colour:
- **Henley** (Thames Valley, English summer): hazy diffuse, high
  Rayleigh scattering, low sun azimuth, soft long shadows.
- **Venice (gothic)**: high humidity, low contrast, foggy distance,
  lagoon reflection bouncing soft cool light from below.
- **Thames (dystopian)**: heavy aerosol scattering, brown-orange smog,
  hard sun disc but low overall illuminance, deep ground shadow.
- **Boston (sci-fi night)**: mostly artificial light sources (neon /
  signage / windows), moonlight rim only, very low sun, high contrast.
- **Willowbrook**: temperate riverside, clear sky, mid-morning sun.
- **Crystal Bled (alpine lake)**: high altitude, low aerosol, very
  cool blue ambient, intense direct sun, crisp distant peaks.

## Proposed change
- Extract a `LIGHTING_PROFILES: Record<RouteTheme, LightingProfile>`
  table to a new module `src/three/lightingProfiles.ts` (composes with
  #110 centralising rendering config). A `LightingProfile` contains:
  - `sunElevationDeg`, `sunAzimuthDeg`
  - `sunColor`, `sunIntensity`
  - `skyColor`, `groundColor`, `hemiIntensity`
  - `fillColor`, `fillIntensity`
  - `ambientColor`, `ambientIntensity`
  - `rayleigh`, `mieCoefficient`, `mieDirectionalG`, `turbidity`
    (for the procedural skydome)
  - `aerosolDensity` (drives FogExp2 density and aerial perspective)
- Replace inline ternaries with a single `useMemo(() => LIGHTING_PROFILES[routeTheme])`.
- Add light-source variety per theme:
  - Boston sci-fi gets a low moon `directionalLight` + many small
    coloured `pointLight`s for window/sign emission (cap total ≤8 on
    `high`, ≤4 on `medium`, 0 on `low`).
  - Steampunk Henley gets a warm rim light from sun-low angle.
  - Dystopian Thames gets a heavily attenuated sun + brown bounce light.
- Add a per-theme weather token (`clear` / `hazy` / `foggy` / `smoggy`
  / `overcast`) feeding the existing fog density.

## Acceptance criteria
- [ ] No `routeTheme === '...'` ternaries remain in the lighting block
      of `Rower3D.tsx`; values come from the new profile table.
- [ ] Each of the six themes produces a visibly distinct sun direction
      and shadow length in screenshots (verified by the Playwright docs
      screenshot test).
- [ ] Boston has additional emissive point lights; Bled has none beyond
      the sun + sky; the difference is obvious side-by-side.
- [ ] Profile values are unit-tested for presence (every `RouteTheme`
      key has every required field — type system enforced).
- [ ] All checks (`npm run lint`, `npm run test -- --run`,
      `npm run build`) pass.
