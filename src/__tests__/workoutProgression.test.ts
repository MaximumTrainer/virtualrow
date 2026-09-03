import { describe, it, expect, beforeEach } from 'vitest';
import { WorkoutGeneratorService } from '../services/workoutGeneratorService';
import type { PM5Data, StructuredWorkout, WorkoutSegment } from '../types/index';

/**
 * Segment progression, tested against the acceptance criteria of #67 rather
 * than against the shape of the implementation.
 *
 * The existing service tests cover a single time-based segment. What matters
 * for the workouts the issue actually describes — warmup, intervals, rests,
 * cooldown, and at least one segment measured in metres — is what happens at
 * the joins, and in particular what happens when the two kinds sit next to
 * each other.
 */

const segment = (over: Partial<WorkoutSegment> = {}): WorkoutSegment => ({
  id: `s${over.order ?? 0}`,
  order: over.order ?? 0,
  type: 'work',
  ...over,
});

const workoutOf = (segments: WorkoutSegment[]): StructuredWorkout => ({
  id: 'progression',
  name: 'Progression fixture',
  description: '',
  type: 'custom',
  segments,
  totalDuration: segments.reduce((total, s) => total + (s.duration ?? 0), 0),
  targetMetric: 'pace',
  createdAt: new Date(),
});

/** `elapsedTime` is milliseconds; the service floors it to whole seconds. */
const reading = (seconds: number, meters: number): PM5Data => ({
  elapsedTime: seconds * 1000,
  distance: meters,
});

describe('workout progression', () => {
  let service: WorkoutGeneratorService;

  const run = (segments: WorkoutSegment[]) => {
    service.addWorkout(workoutOf(segments));
    service.startWorkout('progression');
  };

  beforeEach(() => {
    service = new WorkoutGeneratorService();
  });

  describe('time-based segments', () => {
    it('advances when the segment duration has elapsed', () => {
      run([segment({ order: 0, duration: 60 }), segment({ order: 1, duration: 60 })]);

      expect(service.updateProgress(reading(59, 200))!.currentSegmentIndex).toBe(0);
      expect(service.updateProgress(reading(60, 210))!.currentSegmentIndex).toBe(1);
    });

    it('runs every segment type in the order the workout declares', () => {
      run([
        segment({ order: 0, type: 'warmup', duration: 10 }),
        segment({ order: 1, type: 'interval', duration: 10 }),
        segment({ order: 2, type: 'rest', duration: 10 }),
        segment({ order: 3, type: 'work', duration: 10 }),
        segment({ order: 4, type: 'cooldown', duration: 10 }),
      ]);

      const seen: string[] = [];
      for (let t = 0; t <= 50; t += 1) {
        const progress = service.updateProgress(reading(t, t * 4));
        if (progress && seen[seen.length - 1] !== progress.currentSegment.type) {
          seen.push(progress.currentSegment.type);
        }
      }

      expect(seen).toEqual(['warmup', 'interval', 'rest', 'work', 'cooldown']);
    });

    it('marks the workout complete only after the final segment', () => {
      run([segment({ order: 0, duration: 10 }), segment({ order: 1, duration: 10 })]);

      expect(service.updateProgress(reading(10, 40))!.isComplete).toBeFalsy();
      expect(service.updateProgress(reading(20, 80))!.isComplete).toBe(true);
    });
  });

  describe('distance-based segments', () => {
    it('advances when the distance is covered, not before', () => {
      run([
        segment({ order: 0, distance: 500 }),
        segment({ order: 1, distance: 500 }),
      ]);

      // Ten minutes in but only 499 m rowed: still the first segment.
      expect(service.updateProgress(reading(600, 499))!.currentSegmentIndex).toBe(0);
      expect(service.updateProgress(reading(601, 500))!.currentSegmentIndex).toBe(1);
    });

    it('does not advance a distance segment on elapsed time alone (#67 D.3)', () => {
      run([segment({ order: 0, distance: 2000 }), segment({ order: 1, duration: 60 })]);

      const progress = service.updateProgress(reading(3600, 10))!;
      expect(progress.currentSegmentIndex).toBe(0);
      expect(progress.segmentProgress).toBeLessThan(1);
    });
  });

  describe('workouts that mix time and distance', () => {
    it('does not skip a timed segment that follows a distance one', () => {
      // 500 m, then a 60 s piece. The rower takes 120 s over the 500 m.
      run([
        segment({ order: 0, distance: 500 }),
        segment({ order: 1, duration: 60 }),
        segment({ order: 2, duration: 60 }),
      ]);

      const afterDistance = service.updateProgress(reading(120, 500))!;
      expect(afterDistance.currentSegmentIndex).toBe(1);

      // One second into the 60 s piece — it must not already be over.
      const justAfter = service.updateProgress(reading(121, 505))!;
      expect(justAfter.currentSegmentIndex).toBe(1);
      expect(justAfter.segmentProgress).toBeLessThan(10);
    });

    it('measures a distance segment from where it started, not from the row', () => {
      // A 60 s warmup covering 300 m, then a 500 m piece. The 500 m must be
      // 500 m of its own, not 200 m more of the row's total.
      run([
        segment({ order: 0, duration: 60 }),
        segment({ order: 1, distance: 500 }),
      ]);

      expect(service.updateProgress(reading(60, 300))!.currentSegmentIndex).toBe(1);

      const partWay = service.updateProgress(reading(120, 700))!;
      expect(partWay.currentSegmentIndex).toBe(1);
      expect(partWay.segmentProgress).toBeCloseTo(80, 0);

      expect(service.updateProgress(reading(150, 800))!.isComplete).toBe(true);
    });
  });

  describe('repeated blocks', () => {
    it('rows a repeat as the separate segments it expands into', () => {
      run([segment({ order: 0, duration: 30, repeat: 3 })]);

      expect(service.getExpandedCurrentSegments()).toHaveLength(3);
      expect(service.updateProgress(reading(30, 100))!.currentSegmentIndex).toBe(1);
      expect(service.updateProgress(reading(60, 200))!.currentSegmentIndex).toBe(2);
      expect(service.updateProgress(reading(90, 300))!.isComplete).toBe(true);
    });

    it('expands a work/rest pair into an alternating sequence', () => {
      run([
        segment({ order: 0, type: 'interval', duration: 20, repeat: 2 }),
        segment({ order: 1, type: 'rest', duration: 20, repeat: 2 }),
      ]);

      expect(service.getExpandedCurrentSegments().map((s) => s.type)).toEqual([
        'interval', 'interval', 'rest', 'rest',
      ]);
    });
  });

  describe('a gap in the data, as a disconnect leaves behind', () => {
    it('does not advance the workout across the gap at all', () => {
      // The ergometer's clock keeps running while it is disconnected, so the
      // first reading back carries the whole gap. The rower did not row it, so
      // it must not consume the workout (#67 F.1/F.2).
      run([
        segment({ order: 0, duration: 60 }),
        segment({ order: 1, duration: 60 }),
        segment({ order: 2, duration: 60 }),
      ]);

      service.updateProgress(reading(30, 100));
      service.resumeAfterGap(); // the ergometer came back
      const resumed = service.updateProgress(reading(210, 102))!;

      expect(resumed.currentSegmentIndex).toBe(0);
      expect(resumed.segmentElapsedTime).toBe(30);
      expect(resumed.isComplete).toBeFalsy();
    });

    it('picks the segment up where it left off once data resumes', () => {
      run([segment({ order: 0, duration: 60 }), segment({ order: 1, duration: 60 })]);

      service.updateProgress(reading(30, 100));
      service.resumeAfterGap();
      service.updateProgress(reading(210, 102)); // 3 minutes disconnected
      // Thirty more seconds of real rowing completes the first segment.
      const after = service.updateProgress(reading(240, 220))!;

      expect(after.currentSegmentIndex).toBe(1);
    });

    it('counts the time normally when no gap was declared', () => {
      // Without a reconnect the workout has no reason to discount anything,
      // however sparse the readings happen to be.
      run([segment({ order: 0, duration: 60 }), segment({ order: 1, duration: 60 })]);

      service.updateProgress(reading(30, 100));
      expect(service.updateProgress(reading(90, 400))!.currentSegmentIndex).toBe(1);
    });

    it('discounts only the first reading back, not everything after it', () => {
      run([segment({ order: 0, duration: 60 }), segment({ order: 1, duration: 60 })]);

      service.updateProgress(reading(10, 40));
      service.resumeAfterGap();
      service.updateProgress(reading(130, 45)); // two minutes away
      // Fifty more seconds of rowing takes the first segment to its 60 s.
      expect(service.updateProgress(reading(180, 250))!.currentSegmentIndex).toBe(1);
    });

    it('leaves an ordinary reading interval alone', () => {
      run([segment({ order: 0, duration: 60 }), segment({ order: 1, duration: 60 })]);

      for (let t = 1; t <= 60; t += 1) service.updateProgress(reading(t, t * 4));
      expect(service.getCurrentProgress()!.currentSegmentIndex).toBe(1);
    });

    it('still counts distance rowed, because that work really happened', () => {
      // Distance cannot advance without someone pulling; time can.
      run([segment({ order: 0, distance: 500 })]);

      service.updateProgress(reading(30, 100));
      service.resumeAfterGap();
      const resumed = service.updateProgress(reading(210, 500))!;
      expect(resumed.isComplete).toBe(true);
    });

    it('reports total elapsed as time rowed, not time the erg was switched on', () => {
      run([segment({ order: 0, duration: 600 })]);

      service.updateProgress(reading(30, 100));
      service.resumeAfterGap();
      const resumed = service.updateProgress(reading(210, 102))!;
      expect(resumed.totalElapsedTime).toBe(30);
    });

    it('does not treat the first reading of a workout as a gap', () => {
      // A workout started part-way into a session has no previous reading to
      // compare against, and its first reading is not a disconnect.
      run([segment({ order: 0, duration: 10 })]);
      expect(service.updateProgress(reading(15, 60))!.isComplete).toBe(true);
    });
  });
});
