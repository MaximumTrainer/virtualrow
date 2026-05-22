# Photo-realism improvement proposals

This directory contains one markdown file per recommended improvement aimed at
making the in-game 3D rowing scene (`src/components/Rower3D.tsx`) more
photo-realistic. Each file is consumed by the `.github/workflows/create-improvement-issues.yml`
workflow, which opens one GitHub issue per file when manually dispatched.

## Scope

These proposals are **net-new** relative to the existing open graphics /
performance issues (#76–#113 at time of writing). The existing backlog already
covers: anisotropic filtering (#109), `FogExp2` (#108), foliage sway (#107),
normal-map detail on waves (#106), distance LOD (#105), shadow-distance
culling (#100), gating post-processing on `performanceMode` (#99, #82), stable
window emissives (#97), and reduced water tessellation (#96). The proposals
here intentionally avoid duplicating those.

The proposals are organised in two groups:

1. **Engine-level photo-realism** (`01-` through `10-`) — adds capabilities to
   the renderer that benefit every theme: PBR materials, SSAO, CSM, planar
   reflections, god rays, PMREM env maps, stroke-synced spray, water caustics,
   per-theme LUT grading, and auto-exposure.
2. **Location-relative diversity** (`11-` through `16-`) — adds *content*
   variety keyed off `RouteTheme` (`willowbrook`, `crystal-bled`,
   `gothic-venice`, `steampunk-henley`, `dystopian-thames`, `scifi-boston`):
   lighting profiles, water character, tree species libraries, architecture
   kits, shrubbery / ground-cover, and distant-horizon silhouettes — so each
   location reads as a recognisable *place*, not a re-tinted studio set.

## File format (consumed by the workflow)

Each file must contain:

```markdown
## Title
<single-line issue title>

## Labels
`label-a`, `label-b`, `label-c`

## Summary
...

## Motivation
...

## Proposed change
...

## Acceptance criteria
- [ ] ...
```

The `## Title` and `## Labels` sections are stripped before the body is posted
as the issue body. The workflow is **idempotent**: it skips any title that
matches an existing OPEN issue.

## How to create the issues

From the GitHub UI on the branch that introduces this directory:

1. Go to **Actions → "Create improvement issues (temp)" → Run workflow**.
2. Leave `source_dir` as `docs/graphics-improvements`.
3. Run once with `dry_run: true` to preview, then again with `dry_run: false`
   to actually open the issues.

## Performance posture

All proposals must respect the existing `performanceMode` (`low` / `medium` /
`high`) gating used by the rest of the renderer. Anything that adds GPU cost
(SSR, GTAO, god rays, CSM, planar reflections) must be off by default on
`low` and reduced quality on `medium`. See `src/components/Rower3D.tsx`
around the `<Canvas>` setup for the current pattern.
