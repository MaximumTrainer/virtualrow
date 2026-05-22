## Title
Realism: stroke-synced foam and spray particles at catch, drive, and release

## Labels
`realism`, `graphics`, `water`, `particles`, `enhancement`

## Summary
The current wake is a static foam band trailing the hull. Real rowing
produces three distinct visual events per stroke:
1. A small *catch splash* when each blade plunges into the water.
2. A *puddle* — a swirling pool of disturbed water — left behind at the
   release point of each stroke.
3. *Hull spray* peeling away from the bow at higher speeds.

None of these are currently rendered.

## Motivation
Stroke-synced water disturbance is the single most recognisable visual
signature of rowing. Adding it bridges the gap between "generic boat on
water" and "this is rowing."

## Proposed change
- Emit a small GPU particle burst (~20–40 particles, sprite billboards
  with alpha-tested foam texture) at each blade tip at the catch event
  exposed by the existing stroke-phase source (see #112).
- Spawn a flat, fading puddle decal at the release point; advect it
  backwards relative to the boat for ~2 seconds before fading.
- Add a hull-bow spray emitter whose rate scales with `boatSpeed`.
- All emitters are world-space, decoupled from the boat's local frame so
  they correctly appear to stay on the water.
- Reuse a single `ShaderMaterial` + instanced quads to keep draw-call
  count to ≤3 added.

## Acceptance criteria
- [ ] At each catch, a visible white splash spawns at each blade tip in
      sync with the existing `oarPhase` / `strokeCycle` source.
- [ ] Two puddles are visibly present behind the boat at all times during
      rowing (one per side).
- [ ] Spray is invisible at zero speed and clearly visible above ~4 m/s
      simulated boat speed.
- [ ] Particles disposed cleanly on unmount (no growing memory across
      Playwright runs).
- [ ] Disabled when `performanceMode === 'low'`.
