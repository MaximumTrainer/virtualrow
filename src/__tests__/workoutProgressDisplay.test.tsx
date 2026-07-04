import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { WorkoutProgressDisplay } from '../components/WorkoutProgressDisplay';
import type { WorkoutProgress, WorkoutSegment } from '../types';

function makeSegment(overrides: Partial<WorkoutSegment> = {}): WorkoutSegment {
  return {
    id: 'seg-1',
    order: 0,
    type: 'work',
    duration: 120,
    targetPower: 220,
    ...overrides,
  };
}

function makeProgress(overrides: Partial<WorkoutProgress> = {}): WorkoutProgress {
  return {
    workoutId: 'w1',
    currentSegmentIndex: 0,
    currentSegment: makeSegment(),
    segmentElapsedTime: 30,
    segmentProgress: 25,
    totalElapsedTime: 30,
    totalProgress: 25,
    isOnTarget: true,
    ...overrides,
  };
}

describe('WorkoutProgressDisplay', () => {
  it('shows remaining interval time', () => {
    render(
      <WorkoutProgressDisplay
        progress={makeProgress()}
        allSegments={[makeSegment()]}
        currentPower={220}
      />,
    );

    expect(screen.getByText(/Current interval:/)).toBeInTheDocument();
    expect(screen.getByText(/1:30 remaining/)).toBeInTheDocument();
  });

  it('shows power comparison text for current interval', () => {
    render(
      <WorkoutProgressDisplay
        progress={makeProgress()}
        allSegments={[makeSegment()]}
        currentPower={240}
      />,
    );

    expect(screen.getByText('Power 240W / Target 220W')).toBeInTheDocument();
  });
});
