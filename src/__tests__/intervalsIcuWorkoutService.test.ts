import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IntervalsIcuWorkoutService } from '../services/intervalsIcuWorkoutService';

describe('IntervalsIcuWorkoutService', () => {
  const service = new IntervalsIcuWorkoutService();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-04T00:00:00.000Z'));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
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

  it('uses the requested daysAhead window when querying planned workouts', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => [],
    } as Response);

    await service.fetchPlannedRowingWorkouts('token', 'i123', 14);

    const endpoint = String(fetchSpy.mock.calls[0]?.[0] ?? '');
    expect(endpoint).toContain('oldest=2026-07-04');
    expect(endpoint).toContain('newest=2026-07-18');
  });

  it('retries with i-prefixed athlete ID when numeric athlete ID returns 404', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      } as Response);

    await service.fetchPlannedRowingWorkouts('token', '123');

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(String(fetchSpy.mock.calls[0]?.[0] ?? '')).toContain('/api/v1/athlete/123/events');
    expect(String(fetchSpy.mock.calls[1]?.[0] ?? '')).toContain('/api/v1/athlete/i123/events');
  });
});
