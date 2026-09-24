import type { ActivitySample } from '../types/index';

/**
 * The splits a rower actually rowed (#337).
 *
 * `workoutService` has recorded a `Split` at every 500 m boundary since it was
 * written, and nothing has ever shown one. It would not have helped if it had:
 * it stores `pace: data.pace` - the instantaneous pace at the moment the
 * boundary was crossed - and `time: elapsedSeconds`, the clock since the start.
 * A "500 m split" was therefore one second of the row, labelled with the whole
 * row's elapsed time.
 *
 * These come from the 1 Hz sample stream instead, which is the thing that knows
 * what happened *between* two boundaries. It is the same stream the FIT export
 * writes its records from, so the summary and the exported file agree by
 * construction.
 */

export interface Split {
  /** Cumulative metres at the end of this split: 500, 1000, … */
  meters: number;
  /** How long this split took, on its own. */
  seconds: number;
  /** Its own distance over its own time, as seconds per 500 m. */
  paceSPer500: number;
  /** Averages across the split, or null where the row recorded nothing. */
  spm: number | null;
  watts: number | null;
  hr: number | null;
  /** False for the ragged last piece of a row that did not end on a boundary. */
  complete: boolean;
}

/** The distance a rower counts in, and the one the split pace is quoted over. */
export const SPLIT_METERS = 500;

/** Mean of the readings that exist, or null if none did. */
const meanOf = (values: number[]): number | null =>
  values.length === 0 ? null : values.reduce((sum, v) => sum + v, 0) / values.length;

const readings = (samples: ActivitySample[], key: 'cadence' | 'power' | 'heartRate') =>
  meanOf(
    samples
      .map((s) => s[key])
      .filter((v): v is number => typeof v === 'number' && Number.isFinite(v)),
  );

export const splitsFrom = (
  samples: ActivitySample[],
  every: number = SPLIT_METERS,
): Split[] => {
  if (samples.length === 0 || !(every > 0)) return [];

  const splits: Split[] = [];
  let cutStart = 0;
  let boundary = every;
  let startedAt = samples[0].t;
  let startedFrom = samples[0].distance;

  const cut = (endIndex: number, meters: number, complete: boolean) => {
    // The sample that crossed a boundary belongs to the split it ended, not to
    // the one that starts there. Counting it in both dragged the second split's
    // averages toward the first: a hard 500 m followed by an easy one reported
    // the easy one as harder than it was.
    const inside = samples.slice(cutStart === 0 ? 0 : cutStart + 1, endIndex + 1);
    const end = samples[endIndex];
    const seconds = end.t - startedAt;
    const distance = end.distance - startedFrom;

    splits.push({
      meters,
      seconds,
      // Distance over time, not the mean of the pace readings. A rower who
      // sprints the first half of a split and drifts the second rowed it in a
      // time; averaging the readings would flatter or punish them depending
      // only on where the samples happened to land.
      paceSPer500: seconds > 0 && distance > 0 ? (seconds / distance) * SPLIT_METERS : 0,
      spm: readings(inside, 'cadence'),
      watts: readings(inside, 'power'),
      hr: readings(inside, 'heartRate'),
      complete,
    });

    cutStart = endIndex;
    startedAt = end.t;
    startedFrom = end.distance;
  };

  for (let i = 0; i < samples.length; i += 1) {
    // `while`, not `if`: a slow stream can cross more than one boundary
    // between two samples, and a row should not lose a split to a dropped
    // packet.
    while (samples[i].distance >= boundary) {
      cut(i, boundary, true);
      boundary += every;
    }
  }

  // What is left after the last boundary is not a 500 m split. Dropping it
  // loses water the rower rowed; listing it as another split invites comparing
  // a 400 m pace with four 500 m ones. It is kept and marked.
  const last = samples[samples.length - 1];
  if (last.distance > startedFrom) {
    cut(samples.length - 1, Math.round(last.distance), false);
  }

  return splits;
};

/**
 * Today's average split against the rower's best on this route.
 *
 * Negative is faster, because a split is a time: two seconds quicker is minus
 * two. That sign is the thing a caller gets wrong, so it is asserted in the
 * tests rather than only described here.
 *
 * Null on a first row, and on a "best" that is not a time - a stored zero is a
 * row that recorded no pace, not a record nobody can beat.
 */
export const pbDelta = (
  averagePaceSPer500: number,
  best: number | null | undefined,
): number | null =>
  typeof best === 'number' && Number.isFinite(best) && best > 0
    ? averagePaceSPer500 - best
    : null;
