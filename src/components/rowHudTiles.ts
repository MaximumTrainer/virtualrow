/** Which metrics the row screen's HUD shows (#335). */

export type MetricKey = 'split' | 'spm' | 'power' | 'heartRate' | 'distance' | 'time';

/** Below this width the strip keeps four tiles; at it and above, six. */
export const HUD_WIDE_MIN_PX = 900;

/**
 * Which tiles a viewport this wide has room for, in the order they are shown.
 *
 * Six tiles at 32px type need about 900px. Below that the four a rower steers
 * a piece by stay - pace, rate, heart rate, how far - and power and time give
 * way; both are in the summary.
 */
export function metricTiles(width: number): MetricKey[] {
  return width >= HUD_WIDE_MIN_PX
    ? ['split', 'spm', 'power', 'heartRate', 'distance', 'time']
    : ['split', 'spm', 'heartRate', 'distance'];
}
