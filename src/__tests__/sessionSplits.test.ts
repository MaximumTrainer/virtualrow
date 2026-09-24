import { describe, it, expect } from 'vitest';
import { splitsFrom, pbDelta, SPLIT_METERS } from '../utils/sessionSplits';
import type { ActivitySample } from '../types/index';

/**
 * Issue #337 — the splits a rower actually rowed.
 *
 * `workoutService` has recorded a `Split` at every 500 m boundary since it was
 * written, and nothing has ever shown one. It would not have helped if it had:
 * it stores `pace: data.pace`, the *instantaneous* pace at the moment the
 * boundary was crossed, and `time: elapsedSeconds`, the clock since the start.
 * So a "500 m split" was one second of the row, labelled with the whole row's
 * elapsed time.
 *
 * These are computed from the 1 Hz sample stream instead, which is the thing
 * that knows what happened between two boundaries - the same stream the FIT
 * export writes records from.
 */

/** A 1 Hz row at a steady pace, as the sampler records one. */
const steadyRow = (
  metres: number,
  secondsPer500: number,
  over: Partial<ActivitySample> = {},
): ActivitySample[] => {
  const metresPerSecond = 500 / secondsPer500;
  const seconds = Math.round(metres / metresPerSecond);
  return Array.from({ length: seconds + 1 }, (_, t) => ({
    t,
    distance: Math.min(metres, t * metresPerSecond),
    pace: secondsPer500,
    cadence: 24,
    power: 180,
    heartRate: 150,
    ...over,
  }));
};

describe('splits from the sample stream', () => {
  it('cuts a 2000 m row into four', () => {
    const splits = splitsFrom(steadyRow(2000, 120));

    expect(splits.map((s) => s.meters)).toEqual([500, 1000, 1500, 2000]);
    expect(splits.every((s) => s.complete)).toBe(true);
  });

  // The whole point: a split's seconds are its own, not the clock since the
  // start. Four 2:00 splits are four minutes of rowing, not 2 + 4 + 6 + 8.
  it('gives each split its own duration, and they sum to the row', () => {
    const splits = splitsFrom(steadyRow(2000, 120));

    for (const split of splits) expect(split.seconds).toBeCloseTo(120, 0);
    const total = splits.reduce((sum, s) => sum + s.seconds, 0);
    expect(total).toBeCloseTo(480, 0);
  });

  it('reports the pace each split was actually rowed at', () => {
    const splits = splitsFrom(steadyRow(1000, 110));

    for (const split of splits) expect(split.paceSPer500).toBeCloseTo(110, 0);
  });

  /**
   * A split's pace is its distance over its time, not the average of the
   * instantaneous readings inside it.
   *
   * A rower who sprints the first half of a split and drifts the second has
   * rowed it in a time; averaging the two readings would flatter or punish
   * them depending only on how the samples happened to land.
   */
  it('measures pace from the water covered, not from the readings', () => {
    // 500 m in 100 s, but every sample claims a pace of 999.
    const lying = steadyRow(500, 100, { pace: 999 });

    expect(splitsFrom(lying)[0].paceSPer500).toBeCloseTo(100, 0);
  });

  it('averages the rower over each split, not the whole row', () => {
    const fast = steadyRow(500, 120, { cadence: 30, power: 250, heartRate: 170 });
    const slow = steadyRow(500, 120, { cadence: 20, power: 150, heartRate: 140 }).map((s) => ({
      ...s,
      t: s.t + fast.length,
      distance: s.distance + 500,
    }));

    const [first, second] = splitsFrom([...fast, ...slow]);

    expect(first.spm).toBeCloseTo(30, 0);
    expect(second.spm).toBeCloseTo(20, 0);
    expect(first.watts).toBeCloseTo(250, 0);
    expect(second.watts).toBeCloseTo(150, 0);
    expect(first.hr).toBeCloseTo(170, 0);
    expect(second.hr).toBeCloseTo(140, 0);
  });

  /**
   * The last piece of a row is not a 500 m split.
   *
   * A 2400 m row is four splits and 400 m. Dropping the 400 m loses water the
   * rower rowed; listing it as a fifth split invites comparing a 400 m pace
   * with four 500 m ones. It is kept and marked, so the table can show it as
   * what it is.
   */
  it('keeps the last part-split, and says it is one', () => {
    const splits = splitsFrom(steadyRow(2400, 120));

    expect(splits).toHaveLength(5);
    expect(splits[4].meters).toBe(2400);
    expect(splits[4].complete).toBe(false);
    expect(splits.slice(0, 4).every((s) => s.complete)).toBe(true);
  });

  it('gives a row shorter than one split just the part-split', () => {
    const splits = splitsFrom(steadyRow(300, 120));

    expect(splits).toHaveLength(1);
    expect(splits[0].complete).toBe(false);
    expect(splits[0].meters).toBe(300);
  });

  it('has nothing to say about a row with no samples', () => {
    expect(splitsFrom([])).toEqual([]);
  });

  // A paused row leaves a gap in `t`. The split either side of it is still the
  // distance over the time the rower took, gap included - that is what the
  // clock did.
  it('survives a gap in the stream', () => {
    const before = steadyRow(500, 120);
    const after = steadyRow(500, 120).map((s) => ({
      ...s,
      t: s.t + before.length + 30,
      distance: s.distance + 500,
    }));

    const splits = splitsFrom([...before, ...after]);

    expect(splits).toHaveLength(2);
    expect(splits[1].seconds).toBeGreaterThan(120);
  });

  it('carries no reading for a row that recorded none', () => {
    const bare = steadyRow(500, 120).map(({ t, distance }) => ({ t, distance }));

    const [split] = splitsFrom(bare);

    expect(split.spm).toBeNull();
    expect(split.watts).toBeNull();
    expect(split.hr).toBeNull();
    expect(split.paceSPer500).toBeCloseTo(120, 0);
  });

  it('cuts at whatever distance it is asked to', () => {
    expect(splitsFrom(steadyRow(1000, 120), 250).map((s) => s.meters)).toEqual([
      250, 500, 750, 1000,
    ]);
    expect(SPLIT_METERS).toBe(500);
  });
});

describe('comparing a row with a best', () => {
  // Negative is faster, because a split is a time: two seconds quicker is
  // minus two seconds. The sign is the thing a caller gets wrong, so it is
  // stated here rather than in a comment.
  it('is negative when today was quicker', () => {
    expect(pbDelta(118, 120)).toBe(-2);
  });

  it('is positive when today was slower', () => {
    expect(pbDelta(122, 120)).toBe(2);
  });

  it('is nothing at all on a first row', () => {
    expect(pbDelta(120, null)).toBeNull();
    expect(pbDelta(120, undefined)).toBeNull();
  });

  // A best of zero is not a best, it is a row that recorded no pace.
  it('ignores a best that is not a time', () => {
    expect(pbDelta(120, 0)).toBeNull();
    expect(pbDelta(120, Number.NaN)).toBeNull();
  });
});
