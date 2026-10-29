/**
 * Per-palette window-stripe profile for the buildings pass (#567 follow-up).
 *
 * The P1 brick atlas gives every wall a single horizontal "window course" at
 * texel scale, but every building still reads as the same stamp from a few
 * dozen metres out. Biketerra's reference has clearly different *rhythms* of
 * windows between a residential terrace, a commercial glass box and an
 * industrial shed — different pane sizes, different spacings, sometimes
 * windows only near the top. The shader can do that cheaply if the per-
 * instance `paletteIndex` already in `centres[ii].w` picks a profile.
 *
 * This module is the single source of truth for those profiles. The shader
 * mirrors the same constants inline (WGSL can't share arrays with TS); the
 * test suite asserts the TS classifier matches the per-profile design at a
 * handful of known (perim, worldY) points, which is what guards the shader
 * from drifting when either side is edited.
 *
 * The classifier is pure, deterministic, allocation-free and callable in a
 * tight unit-test loop; it is NEVER called at render time (the shader runs
 * the same arithmetic on the GPU).
 */

/** How a wall fragment at a given world position reads for this profile. */
export type WindowCell = 'wall' | 'glass' | 'frame';

/** The four palette profiles the shader already carries. */
export const WINDOW_PROFILE_COUNT = 4;

/**
 * World-space window grid per palette profile. All distances in metres.
 *
 * - `spacingU` × `spacingV`: window-cell pitch along the wall perimeter and
 *   up the wall. Below `baseHeight` (the P1 base course) the shader always
 *   draws the base colour, so profiles don't need a V offset here.
 * - `paneU` × `paneV`: glass pane size. Must be < spacing so a frame always
 *   wraps around each pane.
 * - `frameThickness`: metres of light frame-colour wrapping each pane.
 * - `minHeight` / `maxHeight`: windows exist only in this vertical band.
 *   Industrial sheds set a tight band near the top so most of the wall stays
 *   solid; the fallback profile sets both to Infinity to disable windows.
 */
export interface WindowProfile {
  readonly spacingU: number;
  readonly spacingV: number;
  /** First pane centre, in metres above `minHeight`. For profiles with
   * `spacingV < (maxHeight - minHeight)` set this to `spacingV / 2` so a
   * window centre sits half a cell above the band's base; for a tight band
   * (industrial, where the band is shorter than the spacing) set it to the
   * band half-height so the single row of windows sits in the middle. */
  readonly baseOffsetV: number;
  readonly paneU: number;
  readonly paneV: number;
  readonly frameThickness: number;
  readonly minHeight: number;
  readonly maxHeight: number;
}

/**
 * Profile table — index MUST match the shader's `paletteIndex` ordering:
 *   0 residential, 1 commercial, 2 industrial, 3 fallback.
 *
 * Design rationale per profile:
 *
 * **Residential** — a terrace reads as narrow tall sash windows ~1 m wide,
 * two upright storeys of them. Pitch 1.8 m horizontal × 3.0 m vertical =
 * one window per 5.4 m² of wall, same density as a Georgian townhouse
 * elevation.
 *
 * **Commercial** — wider panes (1.4 m) in the same vertical rhythm so the
 * eye reads a continuous glass band at street level and discrete floors
 * above. Spacing 1.8 × 3.0 m matches residential so a row with both
 * profiles doesn't feel jarringly out of pitch.
 *
 * **Industrial** — a single band of long low windows near the top of the
 * shed. Pitch 3.0 m horizontal × 10 m vertical (so only one row fires
 * within the band). Panes 2.0 × 1.0 m — the clerestory look.
 *
 * **Fallback** — no overlay; the P1 brick-atlas pattern alone carries the
 * wall. `minHeight > maxHeight` short-circuits the classifier.
 */
export const WINDOW_PROFILES: readonly WindowProfile[] = [
  // 0 residential
  {
    spacingU: 1.8,
    spacingV: 3.0,
    baseOffsetV: 1.5,
    paneU: 1.0,
    paneV: 1.6,
    frameThickness: 0.15,
    minHeight: 1.0,
    maxHeight: 60.0,
  },
  // 1 commercial
  {
    spacingU: 1.8,
    spacingV: 3.0,
    baseOffsetV: 1.5,
    paneU: 1.4,
    paneV: 2.0,
    frameThickness: 0.15,
    minHeight: 1.0,
    maxHeight: 120.0,
  },
  // 2 industrial — single clerestory row centred in the 6..9 m band
  {
    spacingU: 3.0,
    spacingV: 10.0,
    baseOffsetV: 1.5,
    paneU: 2.0,
    paneV: 1.0,
    frameThickness: 0.2,
    minHeight: 6.0,
    maxHeight: 9.0,
  },
  // 3 fallback — windows disabled (minHeight > maxHeight)
  {
    spacingU: 1.0,
    spacingV: 1.0,
    baseOffsetV: 0,
    paneU: 0,
    paneV: 0,
    frameThickness: 0,
    minHeight: Infinity,
    maxHeight: -Infinity,
  },
];

/**
 * Classify a wall fragment at `(perim, worldY)` against the given palette
 * profile. `perim` is the horizontal distance along the wall (world x or z
 * depending on wall orientation — the shader picks it from the face normal
 * then passes it straight through); `worldY` is the wall height in metres.
 *
 * Returns `'glass'` for the window pane centre, `'frame'` for the thin
 * light-coloured frame that wraps the pane, and `'wall'` for everything
 * else (the shader falls through to the atlas texel there).
 */
export const classifyWindowCell = (
  paletteIndex: number,
  perim: number,
  worldY: number,
): WindowCell => {
  const idx = Math.max(0, Math.min(paletteIndex, WINDOW_PROFILE_COUNT - 1));
  const p = WINDOW_PROFILES[idx]!;
  if (worldY < p.minHeight || worldY > p.maxHeight) return 'wall';

  const halfPaneU = p.paneU * 0.5;
  const halfPaneV = p.paneV * 0.5;
  // Place a window centre at (perim = 0, worldY = minHeight) and tile from
  // there. `round(x / s) * s` snaps to the nearest cell centre, which keeps
  // the pane symmetric about that centre and makes the test fixtures line
  // up at perim = 0.
  const vRel = worldY - p.minHeight - p.baseOffsetV;
  const localU = perim - Math.round(perim / p.spacingU) * p.spacingU;
  const localV = vRel - Math.round(vRel / p.spacingV) * p.spacingV;
  const absU = Math.abs(localU);
  const absV = Math.abs(localV);

  // Outside the pane + frame → wall.
  if (absU > halfPaneU + p.frameThickness || absV > halfPaneV + p.frameThickness) return 'wall';
  // Inside the pane → glass.
  if (absU < halfPaneU && absV < halfPaneV) return 'glass';
  // Between pane and outer edge → frame.
  return 'frame';
};

