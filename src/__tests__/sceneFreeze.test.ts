import { describe, it, expect } from 'vitest';
import {
  frozenClock,
  frozenProgress,
  frozenStrokeCycle,
  readSceneFreeze,
} from '../components/rower3d/sceneFreeze';

/**
 * Issue #340 — the scene has to be able to hold still.
 *
 * A visual baseline is worth nothing if the picture moves between the run that
 * recorded it and the run that checks it. `__ROWER3D_FREEZE` is what a
 * screenshot spec sets to stop the clock, pin the boat to a point on the route
 * and park the oars mid-stroke; these are the pure reads the scene makes of it.
 */
describe('readSceneFreeze', () => {
  it('reads nothing when the host has no freeze set', () => {
    expect(readSceneFreeze({})).toBeNull();
  });

  it('reads the time and progress a test asked for', () => {
    expect(readSceneFreeze({ __ROWER3D_FREEZE: { time: 12.5, progress: 0.31 } })).toEqual({
      time: 12.5,
      progress: 0.31,
    });
  });

  // The hook comes in over an init script, so it is an edge: a half-written
  // object there should leave the scene running rather than pin it to NaN.
  it.each([
    ['a string payload', 'yes'],
    ['a missing progress', { time: 4 }],
    ['a missing time', { progress: 0.5 }],
    ['a non-finite time', { time: Number.NaN, progress: 0.5 }],
    ['a non-finite progress', { time: 4, progress: Number.POSITIVE_INFINITY }],
  ])('ignores %s', (_label, payload) => {
    expect(readSceneFreeze({ __ROWER3D_FREEZE: payload })).toBeNull();
  });

  it('holds progress inside the route and time at or after its start', () => {
    expect(readSceneFreeze({ __ROWER3D_FREEZE: { time: -3, progress: 1.4 } })).toEqual({
      time: 0,
      progress: 1,
    });
    expect(readSceneFreeze({ __ROWER3D_FREEZE: { time: 2, progress: -0.2 } })).toEqual({
      time: 2,
      progress: 0,
    });
  });
});

describe('the frozen readings', () => {
  const freeze = { time: 12.5, progress: 0.31 };

  it('give the live value when nothing is frozen', () => {
    expect(frozenClock(null, 7.25)).toBe(7.25);
    expect(frozenProgress(null, 0.8)).toBe(0.8);
    expect(frozenStrokeCycle(null, 0.42)).toBe(0.42);
  });

  it('give the frozen value when the scene is held', () => {
    expect(frozenClock(freeze, 7.25)).toBe(12.5);
    expect(frozenProgress(freeze, 0.8)).toBe(0.31);
  });

  // The oars have to land in the same place as the clock, or the boat is the
  // one thing in a frozen frame that still moves.
  it('parks the stroke at the fraction of the second the clock stopped on', () => {
    expect(frozenStrokeCycle(freeze, 0.42)).toBe(0.5);
    expect(frozenStrokeCycle({ time: 12, progress: 0 }, 0.42)).toBe(0);
  });
});
