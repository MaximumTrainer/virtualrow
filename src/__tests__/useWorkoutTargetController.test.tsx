import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import {
  useWorkoutTargetController,
  segmentHasControllableTarget,
  computeTargetPayload,
} from '../hooks/useWorkoutTargetController';
import type { WorkoutSegment } from '../types';
import type { RowerTargetPort } from '../ports';

const makeSegment = (partial: Partial<WorkoutSegment>): WorkoutSegment => ({
  id: 'seg-1',
  order: 0,
  type: 'work',
  duration: 60,
  ...partial,
});

const stubPort = () => {
  const setTargets = vi.fn<Parameters<RowerTargetPort['setTargets']>, void>();
  const port: RowerTargetPort = { setTargets };
  return { port, setTargets };
};

describe('computeTargetPayload (#445, FR5 / D8(a) / D9(a) / AC6 / AC7)', () => {
  it('returns null when the block has no controllable target (AC7)', () => {
    expect(computeTargetPayload(makeSegment({ type: 'warmup' }), 120)).toBeNull();
    expect(segmentHasControllableTarget(makeSegment({ type: 'warmup' }))).toBe(false);
  });

  it('sets pace to the midpoint of the target band (AC6, unclamped case)', () => {
    const payload = computeTargetPayload(
      makeSegment({ targetPaceMin: 110, targetPaceMax: 112 }),
      111, // current pace already within ±10 %, so midpoint 111 survives
    );
    expect(payload).toEqual({ paceSecondsPer500: 111 });
  });

  it('clamps the setpoint to ±10 % of the athlete\'s current pace (AC6)', () => {
    const fast = computeTargetPayload(
      makeSegment({ targetPaceMin: 60, targetPaceMax: 62 }),
      120,
    );
    // Lower bound = 120 * 0.9 = 108, midpoint 61 is below that → clamped up to 108
    expect(fast?.paceSecondsPer500).toBe(108);
    const slow = computeTargetPayload(
      makeSegment({ targetPaceMin: 300, targetPaceMax: 320 }),
      120,
    );
    // Upper bound = 120 * 1.1 = 132, midpoint 310 above → clamped down to 132
    expect(slow?.paceSecondsPer500).toBe(132);
  });

  it('passes power through as-is', () => {
    const payload = computeTargetPayload(
      makeSegment({ targetPower: 250, targetPaceMin: 110, targetPaceMax: 112 }),
      111,
    );
    expect(payload).toEqual({ paceSecondsPer500: 111, powerWatts: 250 });
  });

  it('leaves the pace unbounded (midpoint) when the athlete has not started rowing yet', () => {
    const payload = computeTargetPayload(
      makeSegment({ targetPaceMin: 110, targetPaceMax: 112 }),
      undefined,
    );
    expect(payload).toEqual({ paceSecondsPer500: 111 });
  });
});

describe('useWorkoutTargetController (#445, FR5)', () => {
  it('does not write when active is false (row stage unmounted)', () => {
    const { port, setTargets } = stubPort();
    renderHook(() =>
      useWorkoutTargetController({
        segment: makeSegment({ targetPaceMin: 110, targetPaceMax: 112 }),
        currentPaceSecondsPer500: 111,
        rowerTargets: port,
        active: false,
      }),
    );
    expect(setTargets).not.toHaveBeenCalled();
  });

  it('does not call setTargets when the block has no targets (AC7)', () => {
    const { port, setTargets } = stubPort();
    renderHook(() =>
      useWorkoutTargetController({
        segment: makeSegment({ type: 'warmup' }),
        currentPaceSecondsPer500: 111,
        rowerTargets: port,
        active: true,
      }),
    );
    expect(setTargets).not.toHaveBeenCalled();
  });

  it('writes on mount and again after 200 ms (throttled to 5 Hz, AC6)', () => {
    let now = 0;
    const { port, setTargets } = stubPort();
    const { rerender } = renderHook(
      ({ pace }: { pace: number }) =>
        useWorkoutTargetController({
          segment: makeSegment({ targetPaceMin: 110, targetPaceMax: 112 }),
          currentPaceSecondsPer500: pace,
          rowerTargets: port,
          active: true,
          now: () => now,
        }),
      { initialProps: { pace: 111 } },
    );
    expect(setTargets).toHaveBeenCalledTimes(1);
    now = 100; // 100 ms — within throttle window
    rerender({ pace: 112 });
    expect(setTargets).toHaveBeenCalledTimes(1);
    now = 220; // > 200 ms — next write allowed
    rerender({ pace: 113 });
    expect(setTargets).toHaveBeenCalledTimes(2);
  });

  it('resets the throttle on a segment change so the new block writes immediately', () => {
    let now = 0;
    const { port, setTargets } = stubPort();
    const { rerender } = renderHook(
      ({ seg }: { seg: WorkoutSegment }) =>
        useWorkoutTargetController({
          segment: seg,
          currentPaceSecondsPer500: 120,
          rowerTargets: port,
          active: true,
          now: () => now,
        }),
      {
        initialProps: {
          seg: makeSegment({ id: 'a', targetPaceMin: 110, targetPaceMax: 112 }),
        },
      },
    );
    expect(setTargets).toHaveBeenCalledTimes(1);
    now = 50; // way inside throttle window
    rerender({ seg: makeSegment({ id: 'b', targetPaceMin: 100, targetPaceMax: 102 }) });
    // New segment id → throttle reset → immediate write
    expect(setTargets).toHaveBeenCalledTimes(2);
  });
});
