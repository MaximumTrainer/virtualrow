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

  it('retains every heart-rate sample for the whole row (issue #221, AC1.4)', () => {
    // Regression: HR_SAMPLE_CAP kept only the last 600 samples, so a row past
    // ten minutes silently lost its opening — and endSession() then averaged
    // over a truncated window.
    const svc = new WorkoutService();
    svc.startSession('r2', 'Route 2');
    for (let i = 0; i < 700; i++) {
      svc.updateSessionHeartRate(i + 1);
    }
    const samples = svc.getCurrentSession()!.heartRateSamples!;
    expect(samples).toHaveLength(700);
    expect(samples[0].bpm).toBe(1);
    expect(samples[samples.length - 1].bpm).toBe(700);
  });

  it('averages over the whole row, not the last ten minutes (issue #221, AC1.4)', () => {
    // 1200 samples ramping 1..1200. Over the whole row the mean is 600.5;
    // over the truncated last-600 window it would have been 900.5.
    const svc = new WorkoutService();
    svc.startSession('r2b', 'Route 2b');
    for (let i = 0; i < 1200; i++) {
      svc.updateSessionHeartRate(i + 1);
    }
    const completed = svc.endSession()!;
    expect(completed.heartRateSamples).toHaveLength(1200);
    expect(completed.heartRateAvg).toBe(601); // Math.round(600.5)
    expect(completed.heartRateMax).toBe(1200);
  });

  it('preserves chronological order across a long row', () => {
    const svc = new WorkoutService();
    svc.startSession('r2c', 'Route 2c');
    for (let i = 0; i < 1200; i++) {
      svc.updateSessionHeartRate(i + 1);
    }
    const samples = svc.getCurrentSession()!.heartRateSamples!;
    expect(samples.every((s, i) => i === 0 || s.bpm > samples[i - 1].bpm)).toBe(true);
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
      distance: 0,
      elapsedTime: 0,
      pace: 120,
      power: 200,
      cadence: 30,
      heartRate: 95,
    });

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
    expect(current?.heartRateSamples?.length).toBe(2);
  });
});
