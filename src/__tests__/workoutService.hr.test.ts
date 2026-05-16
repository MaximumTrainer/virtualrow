import { describe, it, expect } from 'vitest';
import { WorkoutService } from '../services/workoutService';

describe('WorkoutService heart rate integration', () => {
  it('updates heart rate samples and computes average implicitly', () => {
    const svc = new WorkoutService();
    const session = svc.startSession('r1', 'Route 1');
    expect(session.id).toBeTruthy();
    svc.updateSessionHeartRate(100);
    svc.updateSessionHeartRate(110);
    svc.updateSessionHeartRate(90);
    const current = svc.getCurrentSession();
    expect(current?.heartRateSamples?.length).toBe(3);
    const avg = Math.round(current!.heartRateSamples!.reduce((s, v) => s + v.bpm, 0) / current!.heartRateSamples!.length);
    expect(avg).toBe(100);
  });

  it('caps heart rate samples length', () => {
    const svc = new WorkoutService();
    svc.startSession('r2', 'Route 2');
    for (let i = 0; i < 700; i++) {
      svc.updateSessionHeartRate(120);
    }
    const current = svc.getCurrentSession();
    expect(current?.heartRateSamples?.length).toBeLessThanOrEqual(600);
  });

  it('persists heartRateAvg and heartRateMax on endSession', () => {
    const svc = new WorkoutService();
    svc.startSession('r3', 'Route 3');
    svc.updateSessionHeartRate(80);
    svc.updateSessionHeartRate(90);
    svc.updateSessionHeartRate(100);
    const completed = svc.endSession();
    expect(completed).not.toBeNull();
    expect(completed!.heartRateAvg).toBe(90);
    expect(completed!.heartRateMax).toBe(100);
  });

  it('records split heart-rate during active sessions when PM5 data reaches split distance', () => {
    const svc = new WorkoutService();
    svc.startSession('r4', 'Route 4');

    svc.updateSessionWithPM5Data({
      distance: 500,
      elapsedTime: 120000,
      pace: 120,
      power: 200,
      cadence: 30,
      heartRate: 95,
    });

    const current = svc.getCurrentSession();
    expect(current?.isActive).toBe(true);
    expect(current?.splits.length).toBe(1);
    expect(current?.splits[0].heartRate).toBe(95);
    expect(current?.heartRateSamples?.length).toBe(1);
  });
});
