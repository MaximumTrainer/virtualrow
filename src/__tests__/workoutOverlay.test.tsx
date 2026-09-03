import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { WorkoutOverlay } from '../components/WorkoutOverlay';
import { INTENSITY_COLORS } from '../utils/workoutPlan';
import type { StructuredWorkout, WorkoutProgress, WorkoutSegment } from '../types/index';

const segment = (over: Partial<WorkoutSegment> = {}): WorkoutSegment => ({
  id: 's1', order: 0, type: 'work', duration: 300, intensity: 'zone3', ...over,
});

const workout = (segments: WorkoutSegment[]): StructuredWorkout => ({
  id: 'w1',
  name: 'Pyramid',
  description: '',
  type: 'pyramid',
  segments,
  totalDuration: segments.reduce((a, s) => a + (s.duration ?? 0), 0),
  targetMetric: 'pace',
  createdAt: new Date(),
});

const progress = (over: Partial<WorkoutProgress> = {}): WorkoutProgress => ({
  workoutId: 'w1',
  currentSegmentIndex: 0,
  currentSegment: segment(),
  segmentElapsedTime: 60,
  segmentProgress: 20,
  totalElapsedTime: 60,
  totalProgress: 10,
  isOnTarget: true,
  deviationPercent: 0,
  ...over,
});

const segments = [
  segment({ id: 'a', type: 'warmup', intensity: 'zone1' }),
  segment({ id: 'b', type: 'work', intensity: 'zone4' }),
  segment({ id: 'c', type: 'cooldown', intensity: 'recovery' }),
];

const props = (over: Partial<React.ComponentProps<typeof WorkoutOverlay>> = {}) => ({
  workout: workout(segments),
  segments,
  progress: progress(),
  deviceConnected: true,
  ...over,
});

describe('WorkoutOverlay', () => {
  it('names the workout and how far through it the rower is', () => {
    render(<WorkoutOverlay {...props({ progress: progress({ totalProgress: 37.4 }) })} />);

    expect(screen.getByText('Pyramid')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: /overall/i })).toHaveAttribute(
      'aria-valuenow',
      '37',
    );
  });

  it('shows the current segment, its type and its own progress', () => {
    render(
      <WorkoutOverlay
        {...props({
          progress: progress({
            currentSegment: segment({ type: 'interval', description: 'Hard 500' }),
            segmentProgress: 64.2,
          }),
        })}
      />,
    );

    expect(screen.getByText('Hard 500')).toBeInTheDocument();
    expect(screen.getByText(/interval/i)).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: /segment/i })).toHaveAttribute(
      'aria-valuenow',
      '64',
    );
  });

  it('falls back to the segment type when it has no description', () => {
    render(<WorkoutOverlay {...props({ progress: progress({ currentSegment: segment({ type: 'rest' }) }) })} />);
    // Both the heading and the type badge read "Rest"; the heading is the one
    // standing in for a missing description.
    expect(screen.getByRole('heading', { level: 4, name: 'Rest' })).toBeInTheDocument();
  });

  it('states what the current segment is asking for', () => {
    render(
      <WorkoutOverlay
        {...props({
          progress: progress({
            currentSegment: segment({ targetPaceMin: 110, targetPaceMax: 125, cadence: 24 }),
          }),
        })}
      />,
    );
    expect(screen.getByText(/1:50–2:05 \/500m/)).toBeInTheDocument();
    expect(screen.getByText(/24 spm/)).toBeInTheDocument();
  });

  it('shows on target when the rower is meeting a real target', () => {
    render(
      <WorkoutOverlay
        {...props({
          progress: progress({ currentSegment: segment({ targetPower: 200 }), isOnTarget: true }),
        })}
      />,
    );
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent(/on target/i);
    expect(status).toHaveAttribute('data-compliance', 'on-target');
  });

  it('tells the rower to ease off when they are over the target', () => {
    render(
      <WorkoutOverlay
        {...props({
          progress: progress({
            currentSegment: segment({ targetPower: 200 }),
            isOnTarget: false,
            deviationPercent: 15,
          }),
        })}
      />,
    );
    expect(screen.getByRole('status')).toHaveAttribute('data-compliance', 'too-fast');
  });

  it('tells the rower to push on when they are under it', () => {
    render(
      <WorkoutOverlay
        {...props({
          progress: progress({
            currentSegment: segment({ targetPower: 200 }),
            isOnTarget: false,
            deviationPercent: -15,
          }),
        })}
      />,
    );
    expect(screen.getByRole('status')).toHaveAttribute('data-compliance', 'too-slow');
  });

  it('does not claim compliance for a segment that set no target', () => {
    render(<WorkoutOverlay {...props({ progress: progress({ currentSegment: segment() }) })} />);
    expect(screen.getByRole('status')).toHaveAttribute('data-compliance', 'untargeted');
  });

  it('draws every segment on the timeline and marks where the rower is', () => {
    render(<WorkoutOverlay {...props({ progress: progress({ currentSegmentIndex: 1 }) })} />);

    const timeline = screen.getByRole('list', { name: /timeline/i });
    const steps = within(timeline).getAllByRole('listitem');
    expect(steps).toHaveLength(3);
    expect(steps[1]).toHaveAttribute('aria-current', 'step');
    expect(steps[0]).not.toHaveAttribute('aria-current', 'step');
  });

  it('colours each timeline step by its intensity zone', () => {
    render(<WorkoutOverlay {...props()} />);
    const steps = within(screen.getByRole('list', { name: /timeline/i })).getAllByRole('listitem');

    expect(steps[0]).toHaveStyle({ backgroundColor: INTENSITY_COLORS.zone1 });
    expect(steps[1]).toHaveStyle({ backgroundColor: INTENSITY_COLORS.zone4 });
    expect(steps[2]).toHaveStyle({ backgroundColor: INTENSITY_COLORS.recovery });
  });

  it('says the rower has finished once the last segment completes', () => {
    render(
      <WorkoutOverlay
        {...props({ progress: progress({ isComplete: true, totalProgress: 100 }) })}
      />,
    );
    expect(screen.getByText(/workout complete/i)).toBeInTheDocument();
  });

  it('warns that progress has stalled when the rower machine drops out', () => {
    render(<WorkoutOverlay {...props({ deviceConnected: false })} />);
    expect(screen.getByRole('alert')).toHaveTextContent(/rowing machine/i);
  });

  it('does not warn about the device once the workout is finished', () => {
    render(
      <WorkoutOverlay
        {...props({ deviceConnected: false, progress: progress({ isComplete: true }) })}
      />,
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('renders nothing at all when no workout is running', () => {
    const { container } = render(<WorkoutOverlay {...props({ progress: null })} />);
    expect(container).toBeEmptyDOMElement();
  });
});
