import { afterEach, describe, expect, it, vi } from 'vitest';
import { IntervalsIcuWorkoutService } from '../services/intervalsIcuWorkoutService';

describe('IntervalsIcuWorkoutService', () => {
  const service = new IntervalsIcuWorkoutService();

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('loads and filters planned rowing workouts', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ([
        {
          id: '1',
          activity_type: 'Rowing',
          workout_doc: {
            id: 'w1',
            name: '4x5min',
            steps: [
              { type: 'warmup', duration: 300, target_power: 180 },
              { type: 'interval', duration: 300, target_power: 240 },
            ],
          },
        },
        {
          id: '2',
          activity_type: 'Run',
          workout_doc: {
            id: 'w2',
            name: 'Tempo Run',
            steps: [{ type: 'work', duration: 1200 }],
          },
        },
      ]),
    } as Response);

    const plans = await service.fetchPlannedRowingWorkouts('token', 'i123');

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(plans).toHaveLength(1);
    expect(plans[0].name).toBe('4x5min');
    expect(plans[0].blocks).toHaveLength(2);
    expect(plans[0].summary).toContain('@');
  });

  it('maps a workout plan to a structured workout', () => {
    const structured = service.toStructuredWorkout({
      id: 'w1',
      name: 'Power Ladder',
      summary: '3 steps @ ~220W',
      source: 'intervals.icu',
      blocks: [
        { id: 'a', type: 'work', label: 'Step 1', durationSec: 120, targetPowerWatts: 220 },
        { id: 'b', type: 'rest', label: 'Recovery', durationSec: 60 },
      ],
      totalDurationSec: 180,
    });

    expect(structured.id).toBe('icu-plan-w1');
    expect(structured.totalDuration).toBe(180);
    expect(structured.targetMetric).toBe('power');
    expect(structured.segments).toHaveLength(2);
  });

  it('throws a user-facing error when planned workouts cannot be loaded', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 500,
    } as Response);

    await expect(service.fetchPlannedRowingWorkouts('token', 'i123')).rejects.toThrow(
      'Unable to load planned workouts (500).',
    );
  });
});
