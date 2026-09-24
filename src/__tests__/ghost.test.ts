import { describe, it, expect } from 'vitest';
import {
  ghostDistanceAt,
  gapMeters,
  ghostFinishSeconds,
  paceGhost,
  recordedGhost,
  lateralOffset,
  formatGap,
  bestRowOnRoute,
  followClock,
  GHOST_LANE_OFFSET_M,
  type GhostSource,
} from '../components/rower3d/ghost';
import type { ActivitySample, WorkoutSession } from '../types/index';

/**
 * Issue #338 — the boat you are chasing.
 *
 * There is one boat on the water and nothing to row against. A ghost is a
 * second boat whose distance at any moment is a pure function of elapsed time:
 * either a constant pace, or the distances a previous row actually recorded.
 */

const recorded = (distances: number[], times?: number[]): ActivitySample[] =>
  distances.map((distance, i) => ({ t: times?.[i] ?? i, distance }));

describe('a pace boat', () => {
  it('holds the pace it was set', () => {
    const ghost = paceGhost(120); // 2:00/500m — 4.166 m/s

    expect(ghostDistanceAt(ghost, 60)).toBeCloseTo(250, 6);
    expect(ghostDistanceAt(ghost, 120)).toBeCloseTo(500, 6);
  });

  it('is on the start line before the row begins', () => {
    expect(ghostDistanceAt(paceGhost(120), 0)).toBe(0);
  });

  // A pace of zero is a boat that never moves, not one that is everywhere at
  // once. It comes from a blank field as readily as from a real setting.
  it('does not divide by a pace of nothing', () => {
    expect(ghostDistanceAt(paceGhost(0), 60)).toBe(0);
  });
});

describe('a recorded ghost', () => {
  it('rows the distances the row it came from recorded', () => {
    const ghost = recordedGhost(recorded([0, 4, 8, 12]));

    expect(ghostDistanceAt(ghost, 2)).toBe(8);
  });

  it('moves smoothly between one second and the next', () => {
    const ghost = recordedGhost(recorded([0, 4, 8]));

    expect(ghostDistanceAt(ghost, 1.5)).toBeCloseTo(6, 6);
  });

  /**
   * A pause leaves a gap in `t` (see `ActivitySample`), so a ghost cannot be
   * indexed by second. Treating sample 3 as "t = 3" would have the ghost jump
   * whenever the row it came from was paused.
   */
  it('reads the clock, not the sample number', () => {
    const ghost = recordedGhost(recorded([0, 100, 200], [0, 10, 60]));

    expect(ghostDistanceAt(ghost, 5)).toBeCloseTo(50, 6);
    expect(ghostDistanceAt(ghost, 35)).toBeCloseTo(150, 6);
  });

  // The ghost finished. It does not keep rowing up the bank while the rower
  // still on the water catches up.
  it('stops where its row stopped', () => {
    const ghost = recordedGhost(recorded([0, 4, 8]));

    expect(ghostDistanceAt(ghost, 2)).toBe(8);
    expect(ghostDistanceAt(ghost, 600)).toBe(8);
  });

  it('is on the start line before its first sample', () => {
    const ghost = recordedGhost(recorded([0, 4], [10, 11]));

    expect(ghostDistanceAt(ghost, 0)).toBe(0);
    expect(ghostDistanceAt(ghost, 10)).toBe(0);
  });

  it('has nowhere to be when the row it came from recorded nothing', () => {
    expect(ghostDistanceAt(recordedGhost([]), 30)).toBe(0);
  });

  /**
   * A recorded row can stall - the monitor keeps sampling while the rower
   * rests - and a ghost that went backwards would be rowing backwards.
   */
  it('never goes backwards, whatever the recording says', () => {
    const ghost = recordedGhost(recorded([0, 50, 40, 90]));

    expect(ghostDistanceAt(ghost, 2)).toBeGreaterThanOrEqual(ghostDistanceAt(ghost, 1));
    expect(ghostDistanceAt(ghost, 3)).toBe(90);
  });
});

describe('the gap between the boats', () => {
  it('is positive when the rower is ahead', () => {
    expect(gapMeters(520, 500)).toBe(20);
  });

  it('is negative when the ghost is ahead', () => {
    expect(gapMeters(480, 500)).toBe(-20);
  });

  it('is level at a dead heat', () => {
    expect(gapMeters(500, 500)).toBe(0);
  });
});

describe('when the ghost finishes', () => {
  it('knows when a pace boat reaches the line', () => {
    expect(ghostFinishSeconds(paceGhost(120), 2_000)).toBeCloseTo(480, 6);
  });

  it('knows when a recorded ghost reached it', () => {
    const ghost = recordedGhost(recorded([0, 100, 200], [0, 10, 60]));

    expect(ghostFinishSeconds(ghost, 150)).toBeCloseTo(35, 6);
  });

  // A ghost that never rowed the distance cannot say when it got there.
  it('says nothing about a line its row never reached', () => {
    expect(ghostFinishSeconds(recordedGhost(recorded([0, 100])), 500)).toBeNull();
    expect(ghostFinishSeconds(paceGhost(0), 500)).toBeNull();
  });
});

describe('the shape of a ghost', () => {
  it('names what it is, so the HUD can say what is being chased', () => {
    const best: GhostSource = recordedGhost(recorded([0, 4]));

    expect(best.kind).toBe('recorded');
    expect(paceGhost(120).kind).toBe('pace');
  });
});

describe('the ghost’s lane', () => {
  /**
   * Two boats on one line is one boat with z-fighting.
   *
   * `getRoutePositionAtProgress` aligns the boat's local +Z with the route
   * tangent, so local +X — starboard — is the tangent turned a quarter turn.
   * The ghost sits that far to port of the centreline, whichever way the river
   * happens to bend.
   */
  it('sits beside the centreline, not on it', () => {
    // Heading along +Z: port is -X.
    expect(lateralOffset(0, 1, GHOST_LANE_OFFSET_M)).toEqual({
      x: -GHOST_LANE_OFFSET_M,
      z: 0,
    });
  });

  it('stays on the same side through a bend', () => {
    // Heading along +X: port is +Z.
    const offset = lateralOffset(1, 0, GHOST_LANE_OFFSET_M);

    expect(offset.x).toBeCloseTo(0, 6);
    expect(offset.z).toBeCloseTo(GHOST_LANE_OFFSET_M, 6);
  });

  // The offset is a distance, so it must not stretch with an unnormalised
  // tangent: the ghost would drift out into the bank on a curve.
  it('is the same distance whatever length the tangent arrives at', () => {
    const long = lateralOffset(0, 5, GHOST_LANE_OFFSET_M);

    expect(Math.hypot(long.x, long.z)).toBeCloseTo(GHOST_LANE_OFFSET_M, 6);
  });

  it('has nowhere to go when there is no heading at all', () => {
    expect(lateralOffset(0, 0, GHOST_LANE_OFFSET_M)).toEqual({ x: 0, z: 0 });
  });
});

describe('the gap, as the HUD says it', () => {
  it('shows metres in hand with the sign spelled out', () => {
    expect(formatGap(12.4)).toBe('+12 m');
  });

  // A real minus, not a hyphen: at HUD size beside a number a hyphen reads as
  // punctuation, and this is the one number whose sign is the whole message.
  it('shows a deficit as a deficit', () => {
    expect(formatGap(-4.2)).toBe('−4 m');
  });

  /**
   * "+0 m" flickering to "−0 m" and back is what a dead heat looks like when
   * the sign is computed from a number rounding across zero, and it reads as
   * the lead changing every stroke.
   */
  it('calls a metre either way level', () => {
    expect(formatGap(0)).toBe('level');
    expect(formatGap(0.4)).toBe('level');
    expect(formatGap(-0.9)).toBe('level');
  });

  it('says nothing when there is no ghost to measure against', () => {
    expect(formatGap(null)).toBe('');
  });
});

describe('choosing the row to race', () => {
  const row = (over: Partial<WorkoutSession>): WorkoutSession =>
    ({
      id: 'r1',
      routeId: 'willowbrook',
      routeName: 'Willowbrook River',
      startTime: new Date('2026-09-01T07:00:00Z'),
      duration: 600,
      distance: 2000,
      averagePace: 125,
      calories: 100,
      samples: recorded([0, 100, 200]),
      splits: [],
      isActive: false,
      ...over,
    }) as WorkoutSession;

  it('races the quickest row on this route', () => {
    const history = [
      row({ id: 'slow', averagePace: 130 }),
      row({ id: 'quick', averagePace: 118 }),
      row({ id: 'middling', averagePace: 124 }),
    ];

    expect(bestRowOnRoute(history, 'willowbrook')?.id).toBe('quick');
  });

  // A best from the Thames is not a best on Willowbrook, and a 5 km paddle is
  // not a comparison for a 500 m sprint.
  it('ignores rows on other routes', () => {
    const history = [row({ id: 'elsewhere', routeId: 'thames', averagePace: 100 })];

    expect(bestRowOnRoute(history, 'willowbrook')).toBeNull();
  });

  it('leaves out the row being rowed right now', () => {
    const history = [row({ id: 'today', averagePace: 100 }), row({ id: 'before' })];

    expect(bestRowOnRoute(history, 'willowbrook', 'today')?.id).toBe('before');
  });

  /**
   * A ghost needs a route to row, not just a time.
   *
   * Sessions have been stored since long before the 1 Hz sample stream, and a
   * guest row is not this athlete's. Either would give the fastest number and
   * a boat that never leaves the start.
   */
  it('will not race a row that recorded no distances', () => {
    const history = [row({ id: 'bare', averagePace: 100, samples: [] })];

    expect(bestRowOnRoute(history, 'willowbrook')).toBeNull();
  });

  it('will not race a guest row, or one still being rowed', () => {
    const history = [
      row({ id: 'guest', averagePace: 100, isGuest: true }),
      row({ id: 'live', averagePace: 101, isActive: true }),
      row({ id: 'kept' }),
    ];

    expect(bestRowOnRoute(history, 'willowbrook')?.id).toBe('kept');
  });

  it('has nothing to race on a route rowed for the first time', () => {
    expect(bestRowOnRoute([], 'willowbrook')).toBeNull();
  });
});

/**
 * Issue #338 — the ghost's clock.
 *
 * The erg reports elapsed time when a BLE packet arrives, once a second or so.
 * A ghost placed straight from that steps down the course a length at a time,
 * so between packets it runs on the frame clock and the erg's reading is what
 * it is corrected to.
 */
describe('following the row’s clock', () => {
  it('fills the gaps between the erg’s packets', () => {
    // Reported 10 s a moment ago; three frames later, still 10 s reported.
    expect(followClock(10, 10, 0.016, true)).toBeCloseTo(10.016, 6);
  });

  it('is corrected by the erg rather than drifting away from it', () => {
    // Our clock has run to 11 s, the erg says 10.2 s: within a packet, so the
    // small disagreement is not worth a jump.
    expect(followClock(11, 10.2, 0.016, true)).toBeCloseTo(11.016, 6);
  });

  /**
   * Never more than one packet ahead.
   *
   * Left to climb, the local clock passes the snap window and is thrown back
   * to the erg's reading - so the ghost rocks back and forth by a second's
   * distance, once a second, which looks like a boat catching a crab.
   */
  it('does not run away between packets', () => {
    expect(followClock(10.99, 10, 0.5, true)).toBeCloseTo(11, 6);
  });

  it('takes the erg’s clock the moment it moves ahead', () => {
    expect(followClock(10.5, 12, 0.016, true)).toBe(12);
  });

  // A pause, a reset or a row starting over is a disagreement no amount of
  // frame time explains.
  it('snaps when the two clocks are further apart than a packet', () => {
    expect(followClock(300, 4, 0.016, true)).toBe(4);
    expect(followClock(4, 300, 0.016, true)).toBe(300);
  });

  it('holds still while the row is not running', () => {
    expect(followClock(11, 10, 0.016, false)).toBe(10);
  });

  // A frame a second long is one the project has measured more than once
  // (#295); the ghost must not teleport through the finish because of one.
  it('does not let a long frame throw the ghost down the course', () => {
    expect(followClock(10, 10, 5, true)).toBeCloseTo(10.25, 6);
  });
});
