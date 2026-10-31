import { willowbrookRiverCoordinates } from '../../data/seedRouteCoordinates';
import { routeTotalDistanceMeters } from '../utils/geoUtils';
import type { StructuredWorkout, WorkoutSegment } from '../types';

export const DEMO_WORKOUT_ID = 'demo-5k-intervals';
export const DEMO_WORKOUT_NAME = 'Sample workout';

/**
 * Route id of the Willowbrook demo route (also hard-coded at
 * `routesStore.svelte.ts:29` and `routeService.ts` route catalogue entry id
 * `'1'`). Kept beside the demo workout so the Phase-2 auto-seed guard reads
 * one constant; a follow-up can dedupe the call-sites against this one.
 */
export const DEMO_ROUTE_ID = '1';

type Template = Readonly<{
  type: WorkoutSegment['type'];
  meters: number;
  intensity: WorkoutSegment['intensity'];
  description: string;
  targetPaceMin: number;
  targetPaceMax: number;
}>;

/**
 * #472 D5a shape: warmup → 4 × (T, rest) → cooldown. The template distances
 * (500 / 750 / 250 / 500 m) sum to 5 000 m — the stylistic "~5 km meandering
 * river" the demo-route source file describes. The live polyline measures
 * ~6.7 km, so we scale the template to `routeTotalDistanceMeters(...)` at
 * module load so #472 AC1 (prescribed total within ±5 m of the live route)
 * holds for the shape agreed in D5a without needing D5a's absolute numbers.
 */
const SEGMENT_TEMPLATE: readonly Template[] = [
  { type: 'warmup', meters: 500, intensity: 'zone2', description: 'Warmup UT2',
    targetPaceMin: 135, targetPaceMax: 145 },
  { type: 'interval', meters: 750, intensity: 'zone4', description: 'T interval',
    targetPaceMin: 115, targetPaceMax: 122 },
  { type: 'rest', meters: 250, intensity: 'zone2', description: 'Recovery UT2',
    targetPaceMin: 135, targetPaceMax: 145 },
  { type: 'interval', meters: 750, intensity: 'zone4', description: 'T interval',
    targetPaceMin: 115, targetPaceMax: 122 },
  { type: 'rest', meters: 250, intensity: 'zone2', description: 'Recovery UT2',
    targetPaceMin: 135, targetPaceMax: 145 },
  { type: 'interval', meters: 750, intensity: 'zone4', description: 'T interval',
    targetPaceMin: 115, targetPaceMax: 122 },
  { type: 'rest', meters: 250, intensity: 'zone2', description: 'Recovery UT2',
    targetPaceMin: 135, targetPaceMax: 145 },
  { type: 'interval', meters: 750, intensity: 'zone4', description: 'T interval',
    targetPaceMin: 115, targetPaceMax: 122 },
  { type: 'rest', meters: 250, intensity: 'zone2', description: 'Recovery UT2',
    targetPaceMin: 135, targetPaceMax: 145 },
  { type: 'cooldown', meters: 500, intensity: 'zone2', description: 'Cooldown UT1',
    targetPaceMin: 125, targetPaceMax: 135 },
];

const TEMPLATE_TOTAL_M = SEGMENT_TEMPLATE.reduce((s, t) => s + t.meters, 0);

function buildSegments(targetTotalMeters: number): WorkoutSegment[] {
  const scale = targetTotalMeters / TEMPLATE_TOTAL_M;
  const scaled = SEGMENT_TEMPLATE.map((t) => Math.round(t.meters * scale));
  const drift = Math.round(targetTotalMeters) - scaled.reduce((s, m) => s + m, 0);
  scaled[scaled.length - 1] += drift;
  return SEGMENT_TEMPLATE.map((t, i) => ({
    id: `${DEMO_WORKOUT_ID}-seg-${i}`,
    order: i,
    type: t.type,
    distance: scaled[i],
    targetPaceMin: t.targetPaceMin,
    targetPaceMax: t.targetPaceMax,
    intensity: t.intensity,
    description: t.description,
  }));
}

const DEMO_ROUTE_TOTAL_M = routeTotalDistanceMeters(willowbrookRiverCoordinates);

/**
 * The placeholder interval workout (#472 FR1).
 *
 * Shape is distance-based so the final cooldown finishes at the route's
 * finish line regardless of pace, and the `WorkoutBlockPanel` block strip
 * reads off `segment.distance` directly rather than inferring it from
 * `duration` + pace.
 */
export const demoIntervalWorkout: StructuredWorkout = {
  id: DEMO_WORKOUT_ID,
  name: DEMO_WORKOUT_NAME,
  description: 'Placeholder interval workout for the signed-out demo (#472).',
  type: 'intervals',
  segments: buildSegments(DEMO_ROUTE_TOTAL_M),
  totalDuration: 0,
  totalDistance: Math.round(DEMO_ROUTE_TOTAL_M),
  targetMetric: 'pace',
  createdAt: new Date(0),
  source: 'manual',
  externalId: DEMO_WORKOUT_ID,
  routeId: DEMO_ROUTE_ID,
};
