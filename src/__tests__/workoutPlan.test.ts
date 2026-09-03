import { describe, it, expect } from 'vitest';
import type { StructuredWorkout, WorkoutSegment } from '../types/index';
import {
  complianceOf,
  describeTargets,
  intensityLabel,
  INTENSITY_COLORS,
  segmentHasTarget,
  summariseWorkout,
  validateWorkout,
} from '../utils/workoutPlan';

const segment = (over: Partial<WorkoutSegment> = {}): WorkoutSegment => ({
  id: 's1',
  order: 0,
  type: 'work',
  duration: 300,
  ...over,
});

const workout = (segments: WorkoutSegment[]): StructuredWorkout => ({
  id: 'w1',
  name: 'Test',
  description: '',
  type: 'custom',
  segments,
  totalDuration: segments.reduce((a, s) => a + (s.duration ?? 0), 0),
  targetMetric: 'pace',
  createdAt: new Date(),
});

describe('segmentHasTarget', () => {
  it('is false for a segment that asks for nothing', () => {
    expect(segmentHasTarget(segment())).toBe(false);
  });

  it('is true for any single configured target', () => {
    expect(segmentHasTarget(segment({ targetPaceMin: 110, targetPaceMax: 120 }))).toBe(true);
    expect(segmentHasTarget(segment({ targetPower: 200 }))).toBe(true);
    expect(segmentHasTarget(segment({ targetHeartRateMin: 140, targetHeartRateMax: 160 }))).toBe(true);
    expect(segmentHasTarget(segment({ cadence: 24 }))).toBe(true);
  });

  it('ignores a half-configured pace range, which cannot be judged', () => {
    expect(segmentHasTarget(segment({ targetPaceMin: 110 }))).toBe(false);
  });
});

describe('complianceOf', () => {
  const onTarget = { isOnTarget: true, deviationPercent: 0 };

  it('says nothing is being asked when the segment sets no target', () => {
    expect(complianceOf(onTarget, segment())).toBe('untargeted');
  });

  it('reports on target when a target exists and is being met', () => {
    expect(complianceOf(onTarget, segment({ targetPower: 200 }))).toBe('on-target');
  });

  it('reads a positive deviation as working too hard', () => {
    expect(
      complianceOf({ isOnTarget: false, deviationPercent: 12 }, segment({ targetPower: 200 })),
    ).toBe('too-fast');
  });

  it('reads a negative deviation as working too easily', () => {
    expect(
      complianceOf({ isOnTarget: false, deviationPercent: -8 }, segment({ targetPower: 200 })),
    ).toBe('too-slow');
  });

  it('does not claim a direction it cannot know', () => {
    // Off target but with no signed deviation: say off-target, not a guess.
    expect(
      complianceOf({ isOnTarget: false, deviationPercent: 0 }, segment({ targetPower: 200 })),
    ).toBe('off-target');
  });

  it('never reports compliance for a segment with no targets, however off it is', () => {
    expect(complianceOf({ isOnTarget: false, deviationPercent: 40 }, segment())).toBe('untargeted');
  });
});

describe('validateWorkout', () => {
  it('accepts a workout whose every segment is bounded', () => {
    const result = validateWorkout(workout([segment(), segment({ id: 's2', distance: 500, duration: undefined })]));
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('refuses a segment with neither a duration nor a distance', () => {
    const result = validateWorkout(workout([segment({ duration: undefined })]));
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/neither a duration nor a distance/i);
  });

  it('names the offending segment so it can be found', () => {
    const bad = segment({ id: 'bad', order: 3, duration: undefined, description: 'Hard bit' });
    expect(validateWorkout(workout([segment(), bad])).errors[0]).toContain('Hard bit');
  });

  it('refuses a workout with no segments at all', () => {
    expect(validateWorkout(workout([])).valid).toBe(false);
  });

  it('refuses a non-positive duration or distance', () => {
    expect(validateWorkout(workout([segment({ duration: 0 })])).valid).toBe(false);
    expect(validateWorkout(workout([segment({ duration: undefined, distance: -5 })])).valid).toBe(false);
  });

  it('collects every problem rather than stopping at the first', () => {
    const result = validateWorkout(
      workout([segment({ id: 'a', duration: undefined }), segment({ id: 'b', duration: undefined })]),
    );
    expect(result.errors).toHaveLength(2);
  });
});

describe('summariseWorkout', () => {
  it('counts segments after expanding repeats', () => {
    const summary = summariseWorkout(workout([segment({ repeat: 4 }), segment({ id: 's2' })]));
    expect(summary.segmentCount).toBe(5);
  });

  it('totals time and distance across the expanded segments', () => {
    const summary = summariseWorkout(
      workout([segment({ duration: 60, repeat: 3 }), segment({ id: 'd', duration: undefined, distance: 500 })]),
    );
    expect(summary.totalDurationSec).toBe(180);
    expect(summary.totalDistanceMeters).toBe(500);
  });

  it('reports no distance for a purely time-based workout', () => {
    expect(summariseWorkout(workout([segment()])).totalDistanceMeters).toBeUndefined();
  });
});

describe('describeTargets', () => {
  it('says so plainly when a segment asks for nothing', () => {
    expect(describeTargets(segment())).toBe('No target');
  });

  it('renders a pace range as a pace, not a number of seconds', () => {
    expect(describeTargets(segment({ targetPaceMin: 110, targetPaceMax: 125 }))).toContain('1:50');
    expect(describeTargets(segment({ targetPaceMin: 110, targetPaceMax: 125 }))).toContain('2:05');
  });

  it('lists every configured target', () => {
    const described = describeTargets(
      segment({ targetPower: 210, targetHeartRateMin: 140, targetHeartRateMax: 155, cadence: 24 }),
    );
    expect(described).toContain('210 W');
    expect(described).toContain('140–155 bpm');
    expect(described).toContain('24 spm');
  });
});

describe('intensity presentation', () => {
  it('has a colour for every zone the segment model allows', () => {
    const zones: NonNullable<WorkoutSegment['intensity']>[] = [
      'recovery', 'zone1', 'zone2', 'zone3', 'zone4', 'zone5', 'max',
    ];
    for (const zone of zones) {
      expect(INTENSITY_COLORS[zone]).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it('gets hotter as the zone climbs, so the timeline reads at a glance', () => {
    expect(INTENSITY_COLORS.recovery).not.toBe(INTENSITY_COLORS.max);
    expect(new Set(Object.values(INTENSITY_COLORS)).size).toBe(7);
  });

  it('labels a zone for people rather than for the enum', () => {
    expect(intensityLabel('recovery')).toBe('Recovery');
    expect(intensityLabel('zone3')).toBe('Zone 3');
    expect(intensityLabel('max')).toBe('Max');
    expect(intensityLabel(undefined)).toBe('Unzoned');
  });
});
