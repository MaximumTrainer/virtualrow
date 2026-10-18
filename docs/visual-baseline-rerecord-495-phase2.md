# Visual-baseline re-record after #495 Phase 2

Phase 2 of #495 flipped `__VIRTUALROW_CSM` default-on, so the sun's shadow
now runs through three's `CSM` with 2 / 3 / 4 cascades at medium / high /
extra-high. The committed PNGs under `playwright/tests/visual/__snapshots__/`
were recorded with the single-shadow-map path, so they no longer match.

This PR exists to re-record them: it carries the `visual-baseline` label,
so the `visual` job records every shot and uploads the artifact. Download
the `visual-baselines-*` artifact from this run, unzip it at the
repository root, commit the changed files, and push to this branch.

The published hero screenshots under `docs/` (`screenshot-rower-3d-*.png`,
`screenshot-activity.png`, `screenshot-route-selection.png`) are in the
same artifact, so #362's deployed images stay in step with the scene.
