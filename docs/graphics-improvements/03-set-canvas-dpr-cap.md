## Title
Perf: cap Canvas `dpr` so high-DPI displays don't render 4× pixels in low-power mode

## Labels
`performance`, `graphics`

## Summary
The `<Canvas>` in `Rower3D.tsx` does not set the `dpr` prop, so react-three-fiber defaults to `window.devicePixelRatio`. On a 2× retina display this means rendering 4× the pixel work — even when `performanceMode === 'low'`. We already branch on `isHighQuality` for `antialias`, `shadows` and `powerPreference`, so it's natural to extend that to pixel ratio.

## Evidence
- `src/components/Rower3D.tsx:4144-4155` — `<Canvas>` config; no `dpr` prop.
- Existing perf branching present on the same Canvas: `shadows={isHighQuality}`, `antialias: isHighQuality`, `powerPreference: isHighQuality ? 'high-performance' : 'low-power'`.

## Proposed approach
- Add `dpr={isHighQuality ? [1, 2] : 1}` (clamp range so r3f picks the lower of native vs ceiling).
- Confirm Playwright screenshot test still produces the expected pixel dimensions; adjust ceiling if needed.

## Out of scope
- Physics / route logic.

## Acceptance criteria
- [ ] `<Canvas>` has an explicit `dpr` prop.
- [ ] In `performanceMode === 'low'`, rendered pixel count is bounded by `[1,1]` (i.e. logical resolution).
- [ ] Docs screenshot test still passes.
