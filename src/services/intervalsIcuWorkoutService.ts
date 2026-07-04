import type { IntervalBlock, StructuredWorkout, WorkoutPlan, WorkoutSegment } from '../types';
import { PROXY_BASE } from './authService';

interface IntervalsWorkoutStep {
  type?: string;
  duration?: number;
  target_power?: number;
  target_pace?: number;
  intensity?: string | number;
  description?: string;
  name?: string;
}

interface IntervalsWorkoutRef {
  id?: string | number;
  name?: string;
  description?: string;
  activity_type?: string;
  sport?: string;
  type?: string;
  category?: string;
  tags?: string[];
  steps?: IntervalsWorkoutStep[];
}

interface IntervalsPlannedEvent {
  id?: string | number;
  start_date_local?: string;
  date?: string;
  activity_type?: string;
  sport?: string;
  type?: string;
  category?: string;
  tags?: string[];
  name?: string;
  description?: string;
  workout_id?: string | number;
  workout?: IntervalsWorkoutRef;
  workout_doc?: IntervalsWorkoutRef;
  steps?: IntervalsWorkoutStep[];
}

const PACE_TARGET_TOLERANCE_SECONDS = 5;
const DEFAULT_LOOKAHEAD_DAYS = 7;

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function isRowingEvent(event: IntervalsPlannedEvent): boolean {
  const raw = [
    event.activity_type,
    event.sport,
    event.type,
    event.category,
    event.workout?.activity_type,
    event.workout?.sport,
    event.workout?.type,
    event.workout?.category,
    event.workout_doc?.activity_type,
    event.workout_doc?.sport,
    event.workout_doc?.type,
    event.workout_doc?.category,
    ...(event.tags ?? []),
    ...(event.workout?.tags ?? []),
    ...(event.workout_doc?.tags ?? []),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return raw.includes('row') || raw.includes('erg');
}

function mapStepType(type?: string): WorkoutSegment['type'] {
  const normalized = type?.toLowerCase() ?? '';
  if (normalized.includes('warm')) return 'warmup';
  if (normalized.includes('cool')) return 'cooldown';
  if (normalized.includes('rest') || normalized.includes('recover')) return 'rest';
  if (normalized.includes('interval')) return 'interval';
  return 'work';
}

function mapIntensity(intensity?: string | number): WorkoutSegment['intensity'] {
  if (typeof intensity === 'number') {
    if (intensity <= 1) return 'recovery';
    if (intensity <= 2) return 'zone1';
    if (intensity <= 3) return 'zone2';
    if (intensity <= 4) return 'zone3';
    if (intensity <= 5) return 'zone4';
    return 'zone5';
  }

  const normalized = intensity?.toLowerCase() ?? '';
  if (normalized.includes('recover')) return 'recovery';
  if (normalized.includes('easy')) return 'zone1';
  if (normalized.includes('tempo')) return 'zone3';
  if (normalized.includes('threshold')) return 'zone4';
  if (normalized.includes('vo2') || normalized.includes('max')) return 'zone5';
  return 'zone2';
}

function buildBlocks(steps: IntervalsWorkoutStep[]): IntervalBlock[] {
  const blocks = steps
    .map((step, index) => {
      const durationSec = Math.max(0, Math.round(step.duration ?? 0));
      if (durationSec <= 0) return null;
      const targetPace = typeof step.target_pace === 'number' && step.target_pace > 0
        ? step.target_pace
        : undefined;

      return {
        id: `icu-step-${index}`,
        type: mapStepType(step.type),
        label: step.description || step.name || step.type || `Step ${index + 1}`,
        durationSec,
        targetPowerWatts: step.target_power,
        targetPaceMin: targetPace
          ? Math.max(0, targetPace - PACE_TARGET_TOLERANCE_SECONDS)
          : undefined,
        targetPaceMax: targetPace
          ? targetPace + PACE_TARGET_TOLERANCE_SECONDS
          : undefined,
        intensity: mapIntensity(step.intensity),
      } satisfies IntervalBlock;
    });

  return blocks.filter((block) => block !== null) as IntervalBlock[];
}

export class IntervalsIcuWorkoutService {
  async fetchPlannedRowingWorkouts(
    accessToken: string,
    athleteId: string,
    daysAhead = DEFAULT_LOOKAHEAD_DAYS,
  ): Promise<WorkoutPlan[]> {
    if (!accessToken || !athleteId) {
      throw new Error('Intervals.icu credentials are missing.');
    }

    const start = formatDate(new Date());
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + Math.max(0, daysAhead));
    const end = formatDate(endDate);
    const endpoint = `${PROXY_BASE}/api/v1/athlete/${encodeURIComponent(athleteId)}/events?oldest=${encodeURIComponent(start)}&newest=${encodeURIComponent(end)}`;

    const response = await fetch(endpoint, {
      headers: {
        Authorization: ['Bearer', accessToken].join(' '),
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Unable to load planned workouts (${response.status}).`);
    }

    const data = await response.json() as IntervalsPlannedEvent[];
    return data
      .filter(isRowingEvent)
      .map((event) => this.mapEventToWorkoutPlan(event))
      .filter((plan): plan is WorkoutPlan => plan !== null);
  }

  toStructuredWorkout(plan: WorkoutPlan): StructuredWorkout {
    const segments: WorkoutSegment[] = plan.blocks.map((block, index) => ({
      id: `${plan.id}-seg-${index}`,
      order: index,
      type: block.type,
      duration: block.durationSec,
      targetPower: block.targetPowerWatts,
      targetPaceMin: block.targetPaceMin,
      targetPaceMax: block.targetPaceMax,
      intensity: block.intensity,
      description: block.label,
    }));

    return {
      id: `icu-plan-${plan.id}`,
      name: plan.name,
      description: `${plan.summary}${plan.scheduledDate ? ` • ${plan.scheduledDate}` : ''}`,
      type: 'intervals',
      segments,
      totalDuration: plan.totalDurationSec,
      targetMetric: segments.some((segment) => segment.targetPower !== undefined) ? 'power' : 'pace',
      createdAt: new Date(),
      source: 'intervals.icu',
      externalId: plan.id,
    };
  }

  private mapEventToWorkoutPlan(event: IntervalsPlannedEvent): WorkoutPlan | null {
    const workout = event.workout_doc ?? event.workout;
    const rawSteps = workout?.steps ?? event.steps ?? [];
    const blocks = buildBlocks(rawSteps);
    if (blocks.length === 0) return null;

    const totalDurationSec = blocks.reduce((sum, block) => sum + block.durationSec, 0);
    if (totalDurationSec <= 0) return null;

    const reps = blocks.length > 1 ? `${blocks.length} steps` : 'single step';
    const target = blocks.find((block) => block.targetPowerWatts !== undefined)?.targetPowerWatts;
    const summary = target ? `${reps} @ ~${Math.round(target)}W` : reps;
    const id = String(event.workout_id ?? workout?.id ?? event.id ?? this.buildFallbackId(event));

    return {
      id,
      name: workout?.name ?? event.name ?? 'Intervals Workout',
      summary,
      scheduledDate: event.start_date_local ?? event.date,
      source: 'intervals.icu',
      blocks,
      totalDurationSec,
    };
  }

  private buildFallbackId(event: IntervalsPlannedEvent): string {
    const date = event.start_date_local ?? event.date ?? 'unscheduled';
    const base = event.name ?? event.description ?? 'workout';
    const normalized = base.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    return `plan-${date}-${normalized || 'unknown'}`;
  }
}

export const intervalsIcuWorkoutService = new IntervalsIcuWorkoutService();
