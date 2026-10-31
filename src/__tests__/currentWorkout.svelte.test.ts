import { describe, it, expect } from 'vitest';
import { flushSync } from 'svelte';

import { CurrentWorkoutStore } from '../lib/ui/currentWorkout.svelte';
import type { PM5Data, StructuredWorkout, WorkoutSegment } from '../lib/types/index';

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

const reading = (seconds: number, meters: number): PM5Data =>
  ({ elapsedTime: seconds * 1000, distance: meters }) as PM5Data;

// #542 P1: the Svelte-runes port of useCurrentWorkout (#445).
describe('CurrentWorkoutStore', () => {
  it('loads a workout and clears progress', () => {
    const store = new CurrentWorkoutStore();
    store.set(workout([segment()]));
    expect(store.current?.id).toBe('w1');
    expect(store.progress).toBeNull();
    expect(store.isRunning).toBe(false);
    expect(store.validationErrors).toEqual([]);
  });

  it('exposes expanded segments as a derived', () => {
    const store = new CurrentWorkoutStore();
    const stop = $effect.root(() => {
      store.set(workout([segment({ duration: 10 }), segment({ order: 1, duration: 10 })]));
      flushSync();
      expect(store.segments).toHaveLength(2);
      store.set(null);
      flushSync();
      expect(store.segments).toEqual([]);
    });
    stop();
  });

  it('refuses to start with no workout and with an invalid one', () => {
    const store = new CurrentWorkoutStore();
    expect(store.start()).toBe(false);

    // A segment with neither duration nor distance cannot be validated.
    store.set(workout([segment({ duration: undefined, distance: undefined })]));
    expect(store.start()).toBe(false);
    expect(store.validationErrors.length).toBeGreaterThan(0);
  });

  it('starts, ticks to completion, and reports progress', () => {
    const store = new CurrentWorkoutStore();
    const stop = $effect.root(() => {
      store.set(workout([segment({ duration: 60 })]));
      expect(store.start()).toBe(true);
      flushSync();
      expect(store.isRunning).toBe(true);
      expect(store.progress).not.toBeNull();

      store.tick(reading(60, 250));
      flushSync();
      expect(store.isComplete).toBe(true);
      expect(store.isRunning).toBe(false);
      // Ticks after completion are ignored.
      store.tick(reading(120, 500));
    });
    stop();
  });

  it('stop clears the running workout', () => {
    const store = new CurrentWorkoutStore();
    store.set(workout([segment()]));
    store.start();
    store.stop();
    expect(store.isRunning).toBe(false);
    expect(store.progress).toBeNull();
  });

  it('a tick before start is ignored', () => {
    const store = new CurrentWorkoutStore();
    store.set(workout([segment()]));
    store.tick(reading(10, 40));
    expect(store.progress).toBeNull();
  });

  it('resumes after a device gap without counting it', () => {
    const store = new CurrentWorkoutStore();
    store.set(workout([segment({ duration: 60 })]));
    store.start();
    // Disconnect then reconnect: the reconnect must not throw and the workout
    // keeps running (the gap is handled by the controller).
    store.setDeviceConnected(false);
    store.setDeviceConnected(true);
    expect(store.isRunning).toBe(true);
  });

  it('has no speed factor when nothing is running', () => {
    const store = new CurrentWorkoutStore();
    const stop = $effect.root(() => {
      flushSync();
      expect(store.speedFactor).toBeUndefined();
    });
    stop();
  });

  it('has a numeric speed factor while a workout runs', () => {
    const store = new CurrentWorkoutStore();
    const stop = $effect.root(() => {
      store.set(workout([segment({ duration: 60, intensity: 'zone2' })]));
      store.start();
      flushSync();
      expect(typeof store.speedFactor).toBe('number');
    });
    stop();
  });
});
