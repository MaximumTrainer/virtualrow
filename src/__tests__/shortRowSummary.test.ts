import { describe, it, expect, beforeEach } from 'vitest';
import { workoutService } from '../services/workoutService';

/**
 * A short row still has an average pace.
 *
 * `averagePace` was computed only from splits, and a split is cut every 500 m —
 * so a row under that distance produced none, `averagePace` stayed 0, and the
 * summary showed "--:--". Found by rowing: a 96 m piece at a steady 2:00/500m
 * displayed that split live on every stroke and then reported no average pace
 * at all when it ended.
 *
 * That is every warm-up, every short sprint, and everyone who stops early.
 */
describe('the summary of a row shorter than one split', () => {
  beforeEach(() => {
    workoutService.endSession();
  });

  it('reports the average pace the rower actually held', () => {
    const session = workoutService.startSession('route-1', 'Willowbrook River');
    expect(session).toBeTruthy();

    // 100 m in 24 seconds is 4.17 m/s, which is 2:00 per 500 m.
    workoutService.updateSessionWithPM5Data({
      distance: 0,
      elapsedTime: 0,
      pace: 120,
      power: 180,
      cadence: 24,
      heartRate: 140,
    });
    workoutService.updateSessionWithPM5Data({
      distance: 100,
      elapsedTime: 24,
      pace: 120,
      power: 180,
      cadence: 24,
      heartRate: 140,
    });

    const ended = workoutService.endSession();

    expect(ended, 'the session did not end').toBeTruthy();
    expect(ended!.splits.length, 'a 100 m row should not have cut a split').toBe(0);
    expect(
      ended!.averagePace,
      'a short row reported no average pace, so the summary shows "--:--"',
    ).toBeGreaterThan(0);
  });
});
