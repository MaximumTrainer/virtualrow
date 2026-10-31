import { render, screen } from '@testing-library/svelte';
import { describe, it, expect } from 'vitest';

import WorkoutBlockPanel from '../lib/ui/WorkoutBlockPanel.svelte';
import type {
  StructuredWorkout,
  WorkoutProgress,
  WorkoutSegment,
} from '../lib/types/index';

// #542 P1 workout view: the below-rower block panel ported from
// WorkoutBlockPanel.tsx (#445 FR4). DOM, classes and copy are kept verbatim so
// the Playwright selectors keep resolving (AC2).

function segment(over: Partial<WorkoutSegment> = {}): WorkoutSegment {
  return {
    id: 's1',
    order: 0,
    type: 'work',
    duration: 120,
    intensity: 'zone3',
    ...over,
  };
}

function progress(over: Partial<WorkoutProgress> = {}): WorkoutProgress {
  const seg = over.currentSegment ?? segment();
  return {
    workoutId: 'w1',
    currentSegmentIndex: 0,
    currentSegment: seg,
    segmentElapsedTime: 30,
    segmentProgress: 25,
    totalElapsedTime: 30,
    totalProgress: 10,
    isOnTarget: true,
    ...over,
  };
}

function workout(segments: WorkoutSegment[]): StructuredWorkout {
  return {
    id: 'w1',
    name: 'Threshold 3×',
    description: '',
    type: 'intervals',
    segments,
    totalDuration: 360,
    targetMetric: 'pace',
    createdAt: new Date('2026-01-01'),
  };
}

interface PanelOverrides {
  workout?: StructuredWorkout;
  segments?: WorkoutSegment[];
  progress?: WorkoutProgress;
  currentPaceSecondsPer500?: number | null;
  currentPowerWatts?: number | null;
  deviceConnected?: boolean;
}

function renderPanel(over: PanelOverrides = {}) {
  const segments = over.segments ?? [
    segment({ id: 'a', description: 'Warm up', type: 'warmup', intensity: 'recovery' }),
    segment({ id: 'b', description: 'Hard', targetPaceMin: 110, targetPaceMax: 115, targetPower: 240 }),
    segment({ id: 'c', description: 'Cool down', type: 'cooldown', intensity: 'zone1' }),
  ];
  const prog = over.progress ?? progress({ currentSegmentIndex: 1, currentSegment: segments[1] });
  return render(WorkoutBlockPanel, {
    props: {
      workout: over.workout ?? workout(segments),
      segments,
      progress: prog,
      currentPaceSecondsPer500: over.currentPaceSecondsPer500 ?? 112,
      currentPowerWatts: over.currentPowerWatts ?? 235,
      deviceConnected: over.deviceConnected ?? true,
      isDemo: (over as PanelOverrides & { isDemo?: boolean }).isDemo ?? false,
      ...over,
    },
  });
}

describe('WorkoutBlockPanel', () => {
  it('renders a timeline step per segment and marks the current one', () => {
    const { container } = renderPanel();
    const steps = container.querySelectorAll('.workout-block-timeline-step');
    expect(steps).toHaveLength(3);

    const current = container.querySelectorAll('.workout-block-timeline-step.is-current');
    expect(current).toHaveLength(1);
    // The second segment is current (index 1).
    expect(steps[1].classList.contains('is-current')).toBe(true);
    expect(steps[1].getAttribute('aria-current')).toBe('step');
    expect(steps[0].getAttribute('aria-current')).toBeNull();

    // The timeline is a labelled ordered list.
    expect(container.querySelector('ol.workout-block-timeline')?.getAttribute('aria-label')).toBe(
      'Workout timeline',
    );
  });

  it('weights a step by its duration and colours it by intensity', () => {
    const { container } = renderPanel({
      segments: [segment({ id: 'a', duration: 240, intensity: 'zone5' })],
      progress: progress({ currentSegmentIndex: 0, currentSegment: segment({ id: 'a', duration: 240 }) }),
    });
    const step = container.querySelector('.workout-block-timeline-step') as HTMLElement;
    expect(step.style.flexGrow).toBe('240');
    expect(step.style.backgroundColor).not.toBe('');
  });

  it('shows the prescribed pace band and power, and the live actual values', () => {
    const { container } = renderPanel({ currentPaceSecondsPer500: 112, currentPowerWatts: 235 });

    const paceTile = container.querySelector('.workout-block-tile[data-metric="pace"]') as HTMLElement;
    expect(paceTile.querySelector('.workout-block-tile-label')?.textContent).toBe('Pace');
    // 110–115 s/500m band → 1:50–1:55.
    expect(paceTile.querySelector('.workout-block-tile-prescribed')?.textContent).toBe('1:50–1:55');
    expect(paceTile.querySelector('.workout-block-tile-actual')?.textContent?.trim()).toBe('1:52');
    expect(paceTile.querySelector('.workout-block-tile-actual')?.getAttribute('data-has-target')).toBe(
      'true',
    );

    const powerTile = container.querySelector('.workout-block-tile[data-metric="power"]') as HTMLElement;
    expect(powerTile.querySelector('.workout-block-tile-prescribed')?.textContent).toBe('240 W');
    expect(powerTile.querySelector('.workout-block-tile-actual')?.textContent?.trim()).toBe('235 W');
  });

  it('shows a dash for actual pace and power before the first stroke', () => {
    const { container } = renderPanel({ currentPaceSecondsPer500: null, currentPowerWatts: null });
    const paceActual = container.querySelector(
      '.workout-block-tile[data-metric="pace"] .workout-block-tile-actual',
    );
    const powerActual = container.querySelector(
      '.workout-block-tile[data-metric="power"] .workout-block-tile-actual',
    );
    expect(paceActual?.textContent?.trim()).toBe('—');
    expect(powerActual?.textContent?.trim()).toBe('—');
  });

  it('marks the tiles as untargeted when the segment sets no targets', () => {
    const seg = segment({ id: 'x', description: 'Free row' });
    const { container } = renderPanel({
      segments: [seg],
      progress: progress({ currentSegmentIndex: 0, currentSegment: seg }),
    });
    const paceActual = container.querySelector(
      '.workout-block-tile[data-metric="pace"] .workout-block-tile-actual',
    );
    expect(paceActual?.getAttribute('data-has-target')).toBe('false');
    expect(
      container.querySelector('.workout-block-tile[data-metric="pace"] .workout-block-tile-prescribed')
        ?.textContent,
    ).toBe('—');
  });

  it('shows the compliance badge when the device is connected and the workout is running', () => {
    const { container } = renderPanel({ deviceConnected: true });
    const badge = container.querySelector('.workout-block-compliance');
    expect(badge).not.toBeNull();
    expect(badge?.getAttribute('data-compliance')).toBe('on-target');
    expect(badge?.textContent?.trim()).toBe('On target');
  });

  it('hides the compliance badge when the ergometer has dropped out', () => {
    const { container } = renderPanel({ deviceConnected: false });
    expect(container.querySelector('.workout-block-compliance')).toBeNull();
    // The panel still renders its card.
    expect(container.querySelector('.workout-block-card')).not.toBeNull();
  });

  it('reads out a too-fast deviation as "Ease off"', () => {
    const seg = segment({ id: 'b', targetPaceMin: 110, targetPaceMax: 115 });
    const { container } = renderPanel({
      segments: [seg],
      progress: progress({
        currentSegmentIndex: 0,
        currentSegment: seg,
        isOnTarget: false,
        deviationPercent: 12,
      }),
    });
    const badge = container.querySelector('.workout-block-compliance');
    expect(badge?.getAttribute('data-compliance')).toBe('too-fast');
    expect(badge?.textContent?.trim()).toBe('Ease off');
  });

  it('swaps the compliance badge for the complete notice at the end', () => {
    const { container } = renderPanel({
      progress: progress({ currentSegmentIndex: 2, isComplete: true }),
    });
    expect(container.querySelector('.workout-block-compliance')).toBeNull();
    const done = container.querySelector('.workout-block-done');
    expect(done?.textContent?.trim()).toBe('Workout complete');
  });

  it('shows elapsed and remaining seconds for the current block', () => {
    const seg = segment({ id: 'b', duration: 120 });
    const { container } = renderPanel({
      segments: [seg],
      progress: progress({ currentSegmentIndex: 0, currentSegment: seg, segmentElapsedTime: 30 }),
    });
    const timing = container.querySelector('.workout-block-timing')?.textContent ?? '';
    expect(timing).toContain('Elapsed 0:30');
    expect(timing).toContain('Remaining 1:30');
  });

  it('labels the panel region with the workout name', () => {
    renderPanel({ workout: workout([segment()]) });
    expect(
      screen.getByRole('region', { name: 'Workout block panel — Threshold 3×' }),
    ).toBeTruthy();
  });

  it('is unchanged for a signed-in rower (isDemo defaults false)', () => {
    const { container } = renderPanel();
    expect(container.querySelector('[data-testid="workout-block-sample-prefix"]')).toBeNull();
    expect(container.querySelector('.workout-block-card--demo')).toBeNull();
    expect(container.querySelector('.workout-block-panel--demo')).toBeNull();
  });

  it('AC4/D8a: `isDemo` shows a visible "Sample workout" prefix and dims the current-block card', () => {
    const { container } = renderPanel({
      // The cast keeps the override map's shape readable while isDemo is still
      // forwarded through `renderPanel`'s rest spread.
      ...( { isDemo: true } as Record<string, unknown> ),
    });
    const prefix = container.querySelector('[data-testid="workout-block-sample-prefix"]');
    expect(prefix?.textContent?.trim()).toBe('Sample workout');
    expect(container.querySelector('.workout-block-card--demo')).toBeTruthy();
    expect(container.querySelector('.workout-block-panel--demo')).toBeTruthy();

    // AC4: aria-label is prefixed too so a screen-reader hears the sample
    // framing before the workout name.
    expect(
      screen.getByRole('region', {
        name: 'Workout block panel — Sample workout — Threshold 3×',
      }),
    ).toBeTruthy();
  });
});
