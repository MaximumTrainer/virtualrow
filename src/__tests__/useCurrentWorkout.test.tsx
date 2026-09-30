import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCurrentWorkout } from '../hooks/useCurrentWorkout';
import type { PM5Data, StructuredWorkout, WorkoutSegment } from '../types/index';

const segment = (over: Partial<WorkoutSegment> = {}): WorkoutSegment => ({
  id: `s${over.order ?? 0}`,
  order: over.order ?? 0,
  type: 'work',
  duration: 60,
  ...over,
});

const workout = (segments: WorkoutSegment[]): StructuredWorkout => ({
  id: 'w1',
  name: 'Test',
  description: '',
  type: 'custom',
  segments,
  totalDuration: segments.reduce((t, s) => t + (s.duration ?? 0), 0),
  targetMetric: 'pace',
  createdAt: new Date(),
});

const reading = (seconds: number, meters: number): PM5Data => ({
  elapsedTime: seconds * 1000,
  distance: meters,
});

describe('useCurrentWorkout (#445)', () => {
  it('is idle before a workout is set', () => {
    const { result } = renderHook(() => useCurrentWorkout());
    expect(result.current.current).toBeNull();
    expect(result.current.isRunning).toBe(false);
    expect(result.current.progress).toBeNull();
    expect(result.current.segments).toEqual([]);
  });

  it('accepts a workout imperatively and lets it start', () => {
    const { result } = renderHook(() => useCurrentWorkout());
    act(() => { result.current.set(workout([segment({ duration: 60 })])); });
    expect(result.current.current?.id).toBe('w1');
    act(() => { result.current.start(); });
    expect(result.current.isRunning).toBe(true);
    expect(result.current.progress?.currentSegmentIndex).toBe(0);
  });

  it('refuses to start a workout with an unbounded segment (#67 F.3)', () => {
    const { result } = renderHook(() => useCurrentWorkout());
    act(() => {
      result.current.set(workout([segment({ duration: undefined, distance: undefined })]));
    });
    let started = true;
    act(() => { started = result.current.start(); });
    expect(started).toBe(false);
    expect(result.current.validationErrors.length).toBeGreaterThan(0);
    expect(result.current.isRunning).toBe(false);
  });

  it('advances progress on ticks and marks complete', () => {
    const { result } = renderHook(() => useCurrentWorkout());
    act(() => {
      result.current.set(workout([segment({ duration: 10 }), segment({ order: 1, duration: 10 })]));
    });
    act(() => { result.current.start(); });
    act(() => { result.current.tick(reading(5, 20)); });
    expect(result.current.progress?.currentSegmentIndex).toBe(0);
    act(() => { result.current.tick(reading(10, 40)); });
    expect(result.current.progress?.currentSegmentIndex).toBe(1);
    act(() => { result.current.tick(reading(20, 80)); });
    expect(result.current.isComplete).toBe(true);
    expect(result.current.isRunning).toBe(false);
  });

  it('clears progress when the workout is cleared', () => {
    const { result } = renderHook(() => useCurrentWorkout());
    act(() => {
      result.current.set(workout([segment()]));
    });
    act(() => { result.current.start(); });
    act(() => { result.current.set(null); });
    expect(result.current.current).toBeNull();
    expect(result.current.isRunning).toBe(false);
    expect(result.current.progress).toBeNull();
  });

  it('exposes a speed factor while running that depends on segment intensity', () => {
    const { result } = renderHook(() => useCurrentWorkout());
    act(() => {
      result.current.set(workout([segment({ duration: 60, intensity: 'zone2' })]));
    });
    act(() => { result.current.start(); });
    expect(result.current.speedFactor).toBeCloseTo(0.8);
  });

  it('does not count the reading-gap of a reconnect against the rower (#67 §8)', () => {
    const { result, rerender } = renderHook(
      ({ connected }: { connected: boolean }) => useCurrentWorkout(connected),
      { initialProps: { connected: true } },
    );
    act(() => {
      result.current.set(workout([segment({ duration: 60 }), segment({ order: 1, duration: 60 })]));
    });
    act(() => { result.current.start(); });
    act(() => { result.current.tick(reading(30, 100)); });
    rerender({ connected: false });
    rerender({ connected: true });
    act(() => { result.current.tick(reading(210, 105)); });
    // Still on segment 0 — the 180s gap did not consume the workout.
    expect(result.current.progress?.currentSegmentIndex).toBe(0);
  });
});
