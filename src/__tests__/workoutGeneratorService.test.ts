import { describe, it, expect, beforeEach } from 'vitest';
import { WorkoutGeneratorService } from '../services/workoutGeneratorService';
import type { PM5Data } from '../types/index';

describe('WorkoutGeneratorService', () => {
  let service: WorkoutGeneratorService;

  beforeEach(() => {
    service = new WorkoutGeneratorService();
  });

  it('should initialize with sample workouts', () => {
    const workouts = service.getAllWorkouts();
    expect(workouts.length).toBeGreaterThan(0);
    expect(workouts[0]).toHaveProperty('id');
    expect(workouts[0]).toHaveProperty('name');
    expect(workouts[0]).toHaveProperty('segments');
  });

  it('should start a workout and return progress', () => {
    const workouts = service.getAllWorkouts();
    const workout = workouts[0];
    
    const progress = service.startWorkout(workout.id);
    
    expect(progress).not.toBeNull();
    expect(progress?.workoutId).toBe(workout.id);
    expect(progress?.currentSegmentIndex).toBe(0);
    expect(progress?.totalElapsedTime).toBe(0);
  });

  it('should update progress based on PM5 data', () => {
    const workouts = service.getAllWorkouts();
    const workout = workouts[0];
    
    service.startWorkout(workout.id);
    
    const pm5Data: PM5Data = {
      pace: 120, // 2:00/500m
      distance: 1000, // 1km
      elapsedTime: 120000, // 2 minutes
      power: 200,
      cadence: 22,
    };
    
    const progress = service.updateProgress(pm5Data);
    
    expect(progress).not.toBeNull();
    expect(progress?.totalElapsedTime).toBe(120);
  });

  it('should expand repeating segments', () => {
    const segments = [
      {
        id: 'seg-1',
        order: 0,
        type: 'warmup' as const,
        duration: 300,
      },
      {
        id: 'seg-2',
        order: 1,
        type: 'work' as const,
        duration: 240,
        repeat: 3,
      },
    ];
    
    const expanded = service.expandSegments(segments);
    
    expect(expanded.length).toBe(4); // 1 warmup + 3 work intervals
    expect(expanded[1].id).toBe('seg-2-rep-1');
    expect(expanded[2].id).toBe('seg-2-rep-2');
    expect(expanded[3].id).toBe('seg-2-rep-3');
  });

  it('should track target compliance', () => {
    const workouts = service.getAllWorkouts();
    const workout = workouts.find(w => w.id === 'warmup-intervals-cooldown');
    
    if (!workout) {
      throw new Error('Test workout not found');
    }
    
    service.startWorkout(workout.id);
    
    // Simulate being on target
    const pm5DataOnTarget: PM5Data = {
      pace: 140, // Within warmup range of 135-145
      distance: 500,
      elapsedTime: 60000,
      power: 150,
      cadence: 18,
    };
    
    const progressOnTarget = service.updateProgress(pm5DataOnTarget);
    expect(progressOnTarget?.isOnTarget).toBe(true);
    
    // Simulate being off target (too fast)
    const pm5DataTooFast: PM5Data = {
      pace: 100, // Too fast for warmup
      distance: 1000,
      elapsedTime: 120000,
      power: 250,
      cadence: 24,
    };
    
    const progressTooFast = service.updateProgress(pm5DataTooFast);
    expect(progressTooFast?.isOnTarget).toBe(false);
  });

  it('should calculate speed adjustment factor', () => {
    const workouts = service.getAllWorkouts();
    const workout = workouts[0];
    
    service.startWorkout(workout.id);
    
    const factor = service.getSpeedAdjustmentFactor();
    
    expect(factor).toBeGreaterThan(0);
    expect(factor).toBeLessThanOrEqual(1.5);
  });

  it('should end workout', () => {
    const workouts = service.getAllWorkouts();
    const workout = workouts[0];
    
    service.startWorkout(workout.id);
    expect(service.getCurrentWorkout()).not.toBeNull();
    
    service.endWorkout();
    expect(service.getCurrentWorkout()).toBeNull();
    expect(service.getCurrentProgress()).toBeNull();
  });

  it('should mark progress as complete after the final segment finishes', () => {
    const service2 = new WorkoutGeneratorService();
    const singleSegmentWorkout = {
      id: 'single-seg',
      name: 'Single Segment Test',
      description: '',
      type: 'custom' as const,
      segments: [
        {
          id: 'only-seg',
          order: 0,
          type: 'work' as const,
          duration: 10, // 10 seconds
        },
      ],
      totalDuration: 10,
      targetMetric: 'time' as const,
      createdAt: new Date(),
      source: 'manual' as const,
    };
    service2.addWorkout(singleSegmentWorkout);
    service2.startWorkout('single-seg');

    // Advance past the segment duration — triggers advanceToNextSegment with no next segment
    const pm5Data: PM5Data = {
      distance: 100,
      elapsedTime: 15000, // 15 seconds — past the 10s segment duration
    };
    const progress = service2.updateProgress(pm5Data);

    expect(progress?.isComplete).toBe(true);
    expect(progress?.totalProgress).toBe(100);
    expect(progress?.segmentProgress).toBe(100);
  });

  it('should add a new workout', () => {
    const initialCount = service.getAllWorkouts().length;
    
    const newWorkout = {
      id: 'test-workout',
      name: 'Test Workout',
      description: 'A test workout',
      type: 'custom' as const,
      segments: [
        {
          id: 'seg-1',
          order: 0,
          type: 'work' as const,
          duration: 600,
          targetPaceMin: 120,
          targetPaceMax: 130,
        },
      ],
      totalDuration: 600,
      targetMetric: 'pace' as const,
      createdAt: new Date(),
      source: 'manual' as const,
    };
    
    service.addWorkout(newWorkout);
    
    expect(service.getAllWorkouts().length).toBe(initialCount + 1);
    expect(service.getWorkoutById('test-workout')).toEqual(newWorkout);
  });
});
