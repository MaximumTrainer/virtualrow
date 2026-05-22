## Title
Realism: add tileable normal-map detail on top of Gerstner waves

## Labels
`graphics`, `realism`

## Summary
The water uses procedural Gerstner waves for macro-scale movement plus `meshPhysicalMaterial` with `clearcoat` and high `reflectivity`. This looks crisp from afar but lacks the small-scale ripple detail that real water has under-foot of the boat — reflections look "too clean", almost glossy plastic, especially in screenshots.

Adding a single tileable water normal map (or two scrolling at different speeds) on top of the wave displacement gives a much more convincing surface without any change to wave dynamics or boat behaviour.

## Evidence
- `src/components/Rower3D.tsx:603-626` — `meshPhysicalMaterial` for water has no `normalMap` / `normalScale`.

## Proposed approach
- Add a small tileable normal map (e.g. 512×512 PNG) to `public/textures/` (or generate procedurally on first run).
- Wire it through `meshPhysicalMaterial.normalMap` with a low `normalScale` (e.g. `[0.3, 0.3]`).
- Animate UV offset by `elapsedTime` for a slow ripple drift. Two layers offset in opposite directions sells the effect.
- Reduce blend strength on low-power mode.

## Out of scope
- Wave physics. Gerstner shader code is untouched.
- Route / boat behaviour.

## Acceptance criteria
- [ ] Water has visible micro-ripple detail in close-up screenshots.
- [ ] Normal-map intensity is tuneable from one place.
- [ ] No measurable frame-time regression on high-quality mode.
