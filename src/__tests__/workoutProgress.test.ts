import { describe, it, expect } from 'vitest';
import { WorkoutProgressController, segmentSpeedFactor } from '../utils/workoutProgress';
import type { PM5Data, StructuredWorkout, WorkoutSegment } from '../types/index';

/**
 * Segment progression, tested against the acceptance criteria of #67 (ported
 * here from `workoutProgression.test.ts` when the underlying service was
 * deleted for #445).
 *
 * What matters at each join between segments — time next to distance,
 * repeats, and a gap in the readings — is the same behaviour the panel used
 * to depend on when the service ran; only the module that owns it has moved.
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

const reading = (seconds: number, meters: number, extra: Partial<PM5Data> = {}): PM5Data => ({
  elapsedTime: seconds * 1000,
  distance: meters,
  ...extra,
});

const start = (segments: WorkoutSegment[]): WorkoutProgressController =>
  new WorkoutProgressController(workoutOf(segments));

describe('workout progression (#445, ported from #67)', () => {
  describe('time-based segments', () => {
    it('advances when the segment duration has elapsed', () => {
      const c = start([segment({ order: 0, duration: 60 }), segment({ order: 1, duration: 60 })]);
      expect(c.update(reading(59, 200)).currentSegmentIndex).toBe(0);
      expect(c.update(reading(60, 210)).currentSegmentIndex).toBe(1);
    });

    it('runs every segment type in the order the workout declares', () => {
      const c = start([
        segment({ order: 0, type: 'warmup', duration: 10 }),
        segment({ order: 1, type: 'interval', duration: 10 }),
        segment({ order: 2, type: 'rest', duration: 10 }),
        segment({ order: 3, type: 'work', duration: 10 }),
        segment({ order: 4, type: 'cooldown', duration: 10 }),
      ]);
      const seen: string[] = [];
      for (let t = 0; t <= 50; t += 1) {
        const progress = c.update(reading(t, t * 4));
        if (seen[seen.length - 1] !== progress.currentSegment.type) {
          seen.push(progress.currentSegment.type);
        }
      }
      expect(seen).toEqual(['warmup', 'interval', 'rest', 'work', 'cooldown']);
    });

    it('marks the workout complete only after the final segment', () => {
      const c = start([segment({ order: 0, duration: 10 }), segment({ order: 1, duration: 10 })]);
      expect(c.update(reading(10, 40)).isComplete).toBeFalsy();
      expect(c.update(reading(20, 80)).isComplete).toBe(true);
    });
  });

  describe('distance-based segments', () => {
    it('advances when the distance is covered, not before', () => {
      const c = start([
        segment({ order: 0, distance: 500 }),
        segment({ order: 1, distance: 500 }),
      ]);
      expect(c.update(reading(600, 499)).currentSegmentIndex).toBe(0);
      expect(c.update(reading(601, 500)).currentSegmentIndex).toBe(1);
    });

    it('does not advance a distance segment on elapsed time alone (#67 D.3)', () => {
      const c = start([segment({ order: 0, distance: 2000 }), segment({ order: 1, duration: 60 })]);
      const progress = c.update(reading(3600, 10));
      expect(progress.currentSegmentIndex).toBe(0);
      expect(progress.segmentProgress).toBeLessThan(1);
    });
  });

  describe('workouts that mix time and distance', () => {
    it('does not skip a timed segment that follows a distance one', () => {
      const c = start([
        segment({ order: 0, distance: 500 }),
        segment({ order: 1, duration: 60 }),
        segment({ order: 2, duration: 60 }),
      ]);
      const afterDistance = c.update(reading(120, 500));
      expect(afterDistance.currentSegmentIndex).toBe(1);
      const justAfter = c.update(reading(121, 505));
      expect(justAfter.currentSegmentIndex).toBe(1);
      expect(justAfter.segmentProgress).toBeLessThan(10);
    });

    it('measures a distance segment from where it started, not from the row', () => {
      const c = start([
        segment({ order: 0, duration: 60 }),
        segment({ order: 1, distance: 500 }),
      ]);
      expect(c.update(reading(60, 300)).currentSegmentIndex).toBe(1);
      const partWay = c.update(reading(120, 700));
      expect(partWay.currentSegmentIndex).toBe(1);
      expect(partWay.segmentProgress).toBeCloseTo(80, 0);
      expect(c.update(reading(150, 800)).isComplete).toBe(true);
    });
  });

  describe('repeated blocks', () => {
    it('rows a repeat as the separate segments it expands into', () => {
      const c = start([segment({ order: 0, duration: 30, repeat: 3 })]);
      expect(c.getExpandedSegments()).toHaveLength(3);
      expect(c.update(reading(30, 100)).currentSegmentIndex).toBe(1);
      expect(c.update(reading(60, 200)).currentSegmentIndex).toBe(2);
      expect(c.update(reading(90, 300)).isComplete).toBe(true);
    });
  });

  describe('a gap in the data, as a disconnect leaves behind', () => {
    it('does not advance the workout across the gap at all', () => {
      const c = start([
        segment({ order: 0, duration: 60 }),
        segment({ order: 1, duration: 60 }),
        segment({ order: 2, duration: 60 }),
      ]);
      c.update(reading(30, 100));
      c.resumeAfterGap();
      const resumed = c.update(reading(210, 102));
      expect(resumed.currentSegmentIndex).toBe(0);
      expect(resumed.segmentElapsedTime).toBe(30);
      expect(resumed.isComplete).toBeFalsy();
    });

    it('picks the segment up where it left off once data resumes', () => {
      const c = start([segment({ order: 0, duration: 60 }), segment({ order: 1, duration: 60 })]);
      c.update(reading(30, 100));
      c.resumeAfterGap();
      c.update(reading(210, 102));
      expect(c.update(reading(240, 220)).currentSegmentIndex).toBe(1);
    });

    it('counts the time normally when no gap was declared', () => {
      const c = start([segment({ order: 0, duration: 60 }), segment({ order: 1, duration: 60 })]);
      c.update(reading(30, 100));
      expect(c.update(reading(90, 400)).currentSegmentIndex).toBe(1);
    });

    it('still counts distance rowed, because that work really happened', () => {
      const c = start([segment({ order: 0, distance: 500 })]);
      c.update(reading(30, 100));
      c.resumeAfterGap();
      expect(c.update(reading(210, 500)).isComplete).toBe(true);
    });

    it('reports total elapsed as time rowed, not time the erg was switched on', () => {
      const c = start([segment({ order: 0, duration: 600 })]);
      c.update(reading(30, 100));
      c.resumeAfterGap();
      expect(c.update(reading(210, 102)).totalElapsedTime).toBe(30);
    });

    it('does not treat the first reading of a workout as a gap', () => {
      const c = start([segment({ order: 0, duration: 10 })]);
      expect(c.update(reading(15, 60)).isComplete).toBe(true);
    });
  });

  describe('compliance', () => {
    it('marks a pace out of band as off-target with a direction', () => {
      const c = start([
        segment({ order: 0, duration: 60, targetPaceMin: 110, targetPaceMax: 120 }),
      ]);
      const tooFast = c.update(reading(1, 5, { pace: 100 }));
      expect(tooFast.isOnTarget).toBe(false);
      expect(tooFast.deviationPercent).toBeGreaterThan(0); // "faster" -> positive
      const tooSlow = c.update(reading(2, 10, { pace: 140 }));
      expect(tooSlow.isOnTarget).toBe(false);
      expect(tooSlow.deviationPercent).toBeLessThan(0);
    });

    it('leaves an untargeted segment as isOnTarget: true', () => {
      const c = start([segment({ order: 0, duration: 60 })]);
      expect(c.update(reading(1, 5, { pace: 120 })).isOnTarget).toBe(true);
    });
  });
});

describe('segmentSpeedFactor (#445)', () => {
  it('scales with intensity zone', () => {
    expect(segmentSpeedFactor(segment({ intensity: 'recovery' }))).toBeCloseTo(0.6);
    expect(segmentSpeedFactor(segment({ intensity: 'zone3' }))).toBeCloseTo(0.9);
    expect(segmentSpeedFactor(segment({ intensity: 'max' }))).toBeCloseTo(1.2);
  });

  it('falls back to 1.0 for an unzoned or missing segment', () => {
    expect(segmentSpeedFactor(segment({}))).toBe(1);
    expect(segmentSpeedFactor(undefined)).toBe(1);
  });
});
