/**
 * Progressive scenery streaming plan.
 *
 * The engine used to fetch every scenery GLB up-front at attach — a burst that
 * can earn a 503 from a static host and blocks the first frame. Instead, each
 * model is loaded only as the boat nears the first of its instances along the
 * route, and more stream in as the row progresses (mirroring the React scene's
 * chunked `readyCount` loading). This module is the pure, GPU-free planning:
 * work out how far along the route each model first appears, then, given the
 * boat's distance and a look-ahead window, decide which models to load next.
 */

export interface CurveDistanceSample {
  /** A point on the route curve in world space. */
  position: readonly [number, number, number];
  /** Distance along the route to this sample, in metres. */
  distanceMeters: number;
}

export interface SceneryStreamGroup {
  id: string;
  instancePositions: readonly (readonly [number, number, number])[];
}

export interface SceneryStreamEntry {
  id: string;
  /** Route distance (m) at which this model's nearest instance sits. */
  triggerDistanceMeters: number;
}

/** Horizontal (x,z) distance-along-route of the sample nearest `pos`. */
const nearestDistanceMeters = (
  pos: readonly [number, number, number],
  samples: readonly CurveDistanceSample[],
): number => {
  if (samples.length === 0) return 0;
  let best = Infinity;
  let bestDist = 0;
  for (const s of samples) {
    const dx = s.position[0] - pos[0];
    const dz = s.position[2] - pos[2];
    const d = dx * dx + dz * dz;
    if (d < best) {
      best = d;
      bestDist = s.distanceMeters;
    }
  }
  return bestDist;
};

/**
 * Build the per-model trigger distances, ascending. A model with no instances
 * never triggers (Infinity) since there is nothing to draw.
 */
export const planSceneryStream = (
  groups: readonly SceneryStreamGroup[],
  samples: readonly CurveDistanceSample[],
): SceneryStreamEntry[] => {
  const entries = groups.map((g) => {
    let trigger = Infinity;
    for (const p of g.instancePositions) {
      const d = nearestDistanceMeters(p, samples);
      if (d < trigger) trigger = d;
    }
    return { id: g.id, triggerDistanceMeters: trigger };
  });
  entries.sort((a, b) => a.triggerDistanceMeters - b.triggerDistanceMeters);
  return entries;
};

/**
 * The not-yet-loaded models whose trigger distance is within
 * `boatDistanceMeters + lookaheadMeters`, nearest first, capped at `maxCount`.
 * `plan` is assumed ascending (as {@link planSceneryStream} returns it).
 */
export const sceneryModelsToLoad = (
  plan: readonly SceneryStreamEntry[],
  loaded: ReadonlySet<string>,
  boatDistanceMeters: number,
  lookaheadMeters: number,
  maxCount: number,
): string[] => {
  const horizon = boatDistanceMeters + lookaheadMeters;
  const out: string[] = [];
  for (const entry of plan) {
    if (out.length >= maxCount) break;
    if (loaded.has(entry.id)) continue;
    if (entry.triggerDistanceMeters > horizon) break; // ascending → nothing further qualifies
    out.push(entry.id);
  }
  return out;
};
