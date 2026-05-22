## Title
Landmarks: wire `routeLandmarks` into `Rower3D` and make landmark placement boat-relative

## Labels
`enhancement`, `3d`, `world`

## Summary
There is a dedicated route landmark registry + renderer, but it is not currently connected to the main 3D scene. Additionally, landmark positions are expressed as fixed world coordinates without an explicit “world scroll / boat-relative” placement model, which makes it easy for landmarks to end up behind the camera or misaligned with the scrolling scenery patterns.

This issue proposes integrating the existing `routeLandmarks` module into `Rower3D` and defining a consistent placement approach that works with the existing boat-follow camera and scenery updates — without changing route geometry or GPS sampling.

## Evidence
- `src/components/routeLandmarks/index.ts:20` — `routeLandmarkRegistry` exists with multiple route configs
- `src/components/routeLandmarks/index.ts:49` — `getRouteLandmarkConfig(routeName, routeTags)` helper exists
- `src/components/routeLandmarks/LandmarkRenderer.tsx:15` — `LandmarkRenderer` renders landmarks from config
- `src/components/routeLandmarks/LandmarkRenderer.tsx:22` — landmarks are positioned using config `x/z` directly (fixed world placement)
- `src/components/Rower3D.tsx:3627` — `RowerScene` already detects theme (`detectRouteTheme(route)`) for scenery selection
- `src/components/Rower3D.tsx:3955` — the scene chooses landscape elements but does not render route landmarks

## Proposed approach
- In `RowerScene`, compute `const landmarkConfig = useMemo(() => getRouteLandmarkConfig(route.name, route.tags), [route.name, route.tags])`.
- Render `<LandmarkRenderer config={landmarkConfig} />` inside the scene (alongside themed landscape elements).
- Define a placement model that works with the existing “boat-follow” scene:
  - Option A: Treat landmark coordinates as *scene-local* and apply a `boatZ` (or similar) offset so landmarks remain in the expected vicinity as scenery scrolls.
  - Option B: Add a simple “render window” that only mounts landmarks when their Z is within a configurable distance band around the boat/camera.
- Add light distance-based culling for expensive landmarks (or at least avoid rendering them when far behind/too far ahead).
- Keep the landmark module pure “scene content + placement”; do not modify route curve generation, GPS sampling, or progress mapping.

## Out of scope
- Route geometry, GPS path sampling, and any changes to how `createRouteCurve()` maps coordinates into world space.
- Expanding route metadata/DB schema for landmarks.

## Acceptance criteria
- [ ] Landmarks appear for matching routes (based on route name/tags) and do not appear for non-matching routes.
- [ ] Landmark placement remains stable relative to the scrolling scenery model (no “stuck at origin” artifacts).
- [ ] No observable perf regression on the workout activity view (basic FPS sanity check or profiler trace).
