/**
 * Which metrics go on the stage, and what they are called (#335).
 *
 * The row screen used to put eight cards in a panel *below* the canvas. On a
 * phone propped against an erg that panel is below the fold, so the numbers a
 * rower is rowing to were the one thing they could not see. The strip is on the
 * stage now, and a stage is only so wide: six tiles at 32px are legible on a
 * laptop and unreadable on a 390px phone.
 *
 * So the tile list is a function of the viewport rather than a constant, and it
 * lives here rather than in the component because "which numbers matter when
 * there is only room for four" is a decision worth testing on its own.
 *
 * Average and maximum heart rate are not on either list. They are summaries of
 * a row, not instruments to row by, and both already appear on the summary
 * screen the row ends at.
 */

/** A number the strip can show. The keys, not the labels — those are below. */
export type HudMetric = 'split' | 'spm' | 'power' | 'hr' | 'distance' | 'time';

/**
 * The narrowest stage that still fits six tiles.
 *
 * Six tiles at the 11px label and 32px value the design asks for need about
 * 150px each before the value starts to truncate; 900px is that with the
 * stage's own insets.
 */
export const WIDE_HUD_MIN_PX = 900;

/** Everything, in the order a rower scans it: pace first, time last. */
const WIDE: readonly HudMetric[] = ['split', 'spm', 'power', 'hr', 'distance', 'time'];

/**
 * The four that survive a phone.
 *
 * Power and elapsed time go. Power because it is a restatement of the split
 * that the split says better, and time because a rower on a phone is looking at
 * the boat, not clock-watching - and both are on the summary.
 */
const NARROW: readonly HudMetric[] = ['split', 'spm', 'hr', 'distance'];

export const metricTiles = (viewportWidth: number): readonly HudMetric[] =>
  viewportWidth >= WIDE_HUD_MIN_PX ? WIDE : NARROW;

/**
 * What each tile is called on screen.
 *
 * The wording is the wording the panel below the stage had. It reads as a
 * label rather than an abbreviation - "Heart Rate", not "bpm" - and a rower
 * who has used the app before does not have to re-learn the screen to find the
 * number they were watching.
 */
export const HUD_METRIC_LABEL: Record<HudMetric, string> = {
  split: 'Split (/500m)',
  spm: 'SPM',
  power: 'Power',
  hr: 'Heart Rate',
  distance: 'Meters',
  time: 'Time',
};
