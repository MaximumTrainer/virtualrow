/**
 * The 1 Hz activity stream behind a completed row (issue #221, R1).
 *
 * Rowers push faster than they need to be recorded — a PM5 notifies at 4 Hz —
 * so the sampler keeps the first packet of each elapsed second and discards
 * the rest. That bounds a session at one sample per second of rowing: about
 * 3,600 for an hour, or roughly 200 kB of plain objects, which is the whole
 * memory footprint of the feature.
 *
 * Position is the rowed `distance` interpolated along the route polyline, the
 * same mapping that puts the boat on the curve in the 3D scene, so the track
 * in the exported file covers the water actually rowed rather than the whole
 * course.
 */
import type { ActivitySample, Coordinate, PM5Data } from '../types/index';
import { cumulativeLengths, interpolateAlong } from '../utils/polylineGeometry';

export class ActivitySampler {
  private samples: ActivitySample[] = [];
  private lastSampledSecond = -1;
  private route: Coordinate[] = [];
  private routeCumulative: number[] = [];

  /** Begin a new series. A route of fewer than two points yields samples with no position. */
  start(routeCoordinates: Coordinate[] = []): void {
    this.samples = [];
    this.lastSampledSecond = -1;
    this.route = routeCoordinates.length >= 2 ? routeCoordinates : [];
    this.routeCumulative = this.route.length >= 2 ? cumulativeLengths(this.route) : [];
  }

  /**
   * Record `data` if its elapsed second has not been recorded yet.
   *
   * `distance` is the session's own distance rather than the rower's raw
   * counter, so it is already offset-corrected and monotonic.
   */
  record(data: PM5Data, elapsedSeconds: number, distance: number): void {
    if (elapsedSeconds <= this.lastSampledSecond) return;
    this.lastSampledSecond = elapsedSeconds;
    this.samples.push({
      t: elapsedSeconds,
      distance,
      pace: data.pace,
      power: data.power,
      cadence: data.cadence,
      heartRate: data.heartRate,
      ...this.positionAt(distance),
    });
  }

  getSamples(): ActivitySample[] {
    return this.samples;
  }

  private positionAt(distance: number): Coordinate | Record<string, never> {
    if (this.route.length === 0) return {};
    return interpolateAlong(this.route, distance, this.routeCumulative);
  }
}
