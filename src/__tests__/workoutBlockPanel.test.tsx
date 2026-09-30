import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { WorkoutBlockPanel } from '../components/WorkoutBlockPanel';
import type {
  StructuredWorkout,
  WorkoutProgress,
  WorkoutSegment,
} from '../types';

const workout: StructuredWorkout = {
  id: 'wo-1',
  name: 'Threshold 4x4',
  description: 'Test',
  type: 'intervals',
  segments: [],
  totalDuration: 1800,
  targetMetric: 'pace',
  createdAt: new Date(),
  source: 'intervals.icu',
};

const seg = (
  id: string,
  overrides: Partial<WorkoutSegment> = {},
): WorkoutSegment => ({
  id,
  order: 0,
  type: 'work',
  duration: 240,
  targetPaceMin: 110,
  targetPaceMax: 112,
  targetPower: 250,
  intensity: 'zone4',
  description: `Block ${id}`,
  ...overrides,
});

const segments: WorkoutSegment[] = [
  seg('a'),
  seg('b'),
  seg('c', { type: 'rest', intensity: 'recovery', targetPaceMin: undefined, targetPaceMax: undefined, targetPower: undefined }),
];

const makeProgress = (idx: number, elapsed = 0): WorkoutProgress => ({
  workoutId: workout.id,
  currentSegmentIndex: idx,
  currentSegment: segments[idx],
  segmentElapsedTime: elapsed,
  segmentProgress: 0,
  totalElapsedTime: elapsed,
  totalProgress: 0,
  isOnTarget: true,
  deviationPercent: 0,
});

describe('WorkoutBlockPanel (#445, FR4 / AC5 / NFR6)', () => {
  it('mounts with a region role naming the workout (NFR6 / AC5)', () => {
    render(
      <WorkoutBlockPanel
        workout={workout}
        segments={segments}
        progress={makeProgress(0)}
        currentPaceSecondsPer500={112}
        currentPowerWatts={240}
        deviceConnected
      />,
    );
    expect(
      screen.getByRole('region', { name: /Workout block panel/i }),
    ).toBeInTheDocument();
  });

  it('highlights the current block on the timeline', () => {
    render(
      <WorkoutBlockPanel
        workout={workout}
        segments={segments}
        progress={makeProgress(1)}
        currentPaceSecondsPer500={112}
        currentPowerWatts={240}
        deviceConnected
      />,
    );
    const timeline = screen.getByRole('list', { name: /Workout timeline/i });
    const steps = within(timeline).getAllByRole('listitem');
    expect(steps[1]).toHaveAttribute('aria-current', 'step');
    expect(steps[0]).not.toHaveAttribute('aria-current');
  });

  it('renders prescribed vs actual pace and power tiles (AC5)', () => {
    render(
      <WorkoutBlockPanel
        workout={workout}
        segments={segments}
        progress={makeProgress(0)}
        currentPaceSecondsPer500={115}
        currentPowerWatts={230}
        deviceConnected
      />,
    );
    // Prescribed pace band 1:50–1:52 (110–112 sec/500m)
    expect(screen.getByText(/1:50–1:52/)).toBeInTheDocument();
    // Prescribed power 250 W
    expect(screen.getByText(/^250 W$/)).toBeInTheDocument();
    // Actual power 230 W
    expect(screen.getByText(/^230 W$/)).toBeInTheDocument();
  });

  it('shows "—" for a metric with no prescribed target (D9(a) / AC7)', () => {
    render(
      <WorkoutBlockPanel
        workout={workout}
        segments={segments}
        progress={makeProgress(2)} // untargeted rest block
        currentPaceSecondsPer500={140}
        currentPowerWatts={100}
        deviceConnected
      />,
    );
    // Prescribed row for both tiles reads "—"
    const dashes = screen.getAllByText('—');
    expect(dashes.length).toBeGreaterThanOrEqual(2);
  });

  it('uses aria-live=polite on actual values only (NFR6)', () => {
    render(
      <WorkoutBlockPanel
        workout={workout}
        segments={segments}
        progress={makeProgress(0)}
        currentPaceSecondsPer500={112}
        currentPowerWatts={240}
        deviceConnected
      />,
    );
    const region = screen.getByRole('region', { name: /Workout block panel/i });
    const politeNodes = region.querySelectorAll('[aria-live="polite"]');
    expect(politeNodes.length).toBe(2);
    // Prescribed values must NOT be live regions (NFR6: only actuals update
    // audibly).
    for (const node of politeNodes) {
      expect(node.classList.contains('workout-block-tile-actual')).toBe(true);
    }
  });

  it('hides the compliance badge while the device is disconnected', () => {
    const { rerender } = render(
      <WorkoutBlockPanel
        workout={workout}
        segments={segments}
        progress={makeProgress(0)}
        currentPaceSecondsPer500={112}
        currentPowerWatts={240}
        deviceConnected
      />,
    );
    // Connected: compliance status shown.
    expect(screen.queryByRole('status')).toBeInTheDocument();
    rerender(
      <WorkoutBlockPanel
        workout={workout}
        segments={segments}
        progress={makeProgress(0)}
        currentPaceSecondsPer500={112}
        currentPowerWatts={240}
        deviceConnected={false}
      />,
    );
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('shows the elapsed / remaining seconds for the current block', () => {
    render(
      <WorkoutBlockPanel
        workout={workout}
        segments={segments}
        progress={makeProgress(0, 65)} // 65s into a 240s block
        currentPaceSecondsPer500={112}
        currentPowerWatts={240}
        deviceConnected
      />,
    );
    expect(screen.getByText(/Elapsed 1:05/)).toBeInTheDocument();
    expect(screen.getByText(/Remaining 2:55/)).toBeInTheDocument();
  });

  it('reads "Workout complete" when the final block is done', () => {
    render(
      <WorkoutBlockPanel
        workout={workout}
        segments={segments}
        progress={{ ...makeProgress(2), isComplete: true }}
        currentPaceSecondsPer500={140}
        currentPowerWatts={100}
        deviceConnected
      />,
    );
    expect(screen.getByText(/Workout complete/i)).toBeInTheDocument();
  });
});
