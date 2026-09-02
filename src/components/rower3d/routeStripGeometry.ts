import * as THREE from 'three';
import {
  MAX_ROUTE_SEGMENTS,
  MIN_ROUTE_SEGMENTS,
  TARGET_METERS_BETWEEN_SEGMENTS,
  curveLengthMeters,
} from './curve';
import { SCENE_SCALE } from './constants';
import { WHOLE_ROUTE, type ProgressRange } from './geometryChunks';
import type { RouteEnrichmentData } from '../../services/routeEnrichmentService';

// ============================================================================
// Shared frame math for the ribbons that follow a route: the water channel and
// the two riverbanks. Each builder owns its own vertex layout; what they share
// is how a point on the curve becomes a left-hand normal to offset from, and
// where along the curve to take those samples.
// ============================================================================

export interface StripGeometryOptions {
  enrichment?: RouteEnrichmentData | null;
  /** Slice of the curve to build. Defaults to the whole route. */
  range?: ProgressRange;
}

const UP = new THREE.Vector3(0, 1, 0);
const frameTangent = new THREE.Vector3();

/**
 * Curve point and the left-hand horizontal perpendicular at `t`, written into
 * the caller's vectors.
 *
 * Out-params rather than returns: a 20 km route is built at 800 segments across
 * three strips, and a fresh `Vector3` per sample is thousands of objects the
 * collector has to sweep while the rower waits for the first frame (#224).
 */
export const sampleStripFrame = (
  curve: THREE.CatmullRomCurve3,
  t: number,
  outPoint: THREE.Vector3,
  outPerp: THREE.Vector3,
): void => {
  curve.getPointAt(t, outPoint);
  curve.getTangentAt(t, frameTangent).normalize();
  outPerp.crossVectors(frameTangent, UP).normalize();
};

/**
 * Most the *centreline* may turn across one segment.
 *
 * The edge the rower actually sees is the waterline, and on the inside of a
 * bend it turns harder than the centre does — by the ratio of the two radii.
 * On a 40 m bend through 30 m of water that is 1.6x, so this target is set
 * below the six degrees (a sixty-sided circle) at which an edge starts to read
 * as straight, leaving the visible line inside it.
 */
export const MAX_TURN_PER_SEGMENT_DEGREES = 4;

const MAX_TURN_PER_SEGMENT_RADIANS = (MAX_TURN_PER_SEGMENT_DEGREES * Math.PI) / 180;

/**
 * Ceiling on what one probe interval may claim from the segment budget.
 *
 * Reconstructing a thinned track through cubic Hermite leaves the occasional
 * curvature spike. Uncapped, one such kink claims the whole route's budget and
 * the schedule emits sub-centimetre segments there while the real bends starve.
 */
const MAX_TURN_COST_PER_PROBE = 4;

/** Shortest segment worth emitting, in metres of route. */
const MIN_SEGMENT_METERS = 0.5;

/**
 * How much geometry each stretch of curve has earned.
 *
 * Distributing segments evenly by distance spends the same budget on a straight
 * kilometre and on a hairpin, so a 180-degree bend taken at 15 m per segment
 * turns 22 degrees a segment and shows every edge. Cost here is the sum of two
 * demands — one segment per `TARGET_METERS_BETWEEN_SEGMENTS`, plus one per
 * `MAX_TURN_PER_SEGMENT_DEGREES` of turning — so straight water is sampled
 * exactly as before and bends pull samples in proportion to how hard they turn.
 */
interface DetailProfile {
  /** Probe parameters, ascending from 0 to 1. */
  t: Float64Array;
  /** Cumulative cost at each probe; the last entry is the whole-route total. */
  cost: Float64Array;
  /** Segments the whole route earns, clamped. */
  segments: number;
  /** Real-world length of the route the profile was built from. */
  lengthMeters: number;
}

const profileCache = new WeakMap<THREE.CatmullRomCurve3, DetailProfile>();

const buildDetailProfile = (curve: THREE.CatmullRomCurve3): DetailProfile => {
  const lengthMeters = curveLengthMeters(curve);
  // A probe every 2 m, capped. Bends need probes finer than the turn they make
  // — at 10 m spacing a 15 m radius bend turns 38 degrees between probes and
  // the profile cannot see it — while the cap keeps a marathon bounded. The
  // chord directions below replace `getTangentAt`, which costs two more
  // arc-length lookups of its own for the same answer.
  const probes = Math.max(200, Math.min(2000, Math.ceil(lengthMeters / 2)));

  const t = new Float64Array(probes + 1);
  const cost = new Float64Array(probes + 1);

  const previous = new THREE.Vector3();
  const current = new THREE.Vector3();
  const chord = new THREE.Vector3();
  const previousChord = new THREE.Vector3();

  curve.getPointAt(0, previous);
  let hasPreviousChord = false;
  let running = 0;

  for (let i = 1; i <= probes; i++) {
    const at = i / probes;
    curve.getPointAt(at, current);
    chord.subVectors(current, previous);

    const stepMeters = chord.length() / SCENE_SCALE;
    let turnRadians = 0;
    if (hasPreviousChord && chord.lengthSq() > 0 && previousChord.lengthSq() > 0) {
      turnRadians = previousChord.angleTo(chord);
    }

    running +=
      stepMeters / TARGET_METERS_BETWEEN_SEGMENTS +
      Math.min(MAX_TURN_COST_PER_PROBE, turnRadians / MAX_TURN_PER_SEGMENT_RADIANS);

    t[i] = at;
    cost[i] = running;
    previousChord.copy(chord);
    hasPreviousChord = true;
    previous.copy(current);
  }

  return {
    t,
    cost,
    segments: Math.max(MIN_ROUTE_SEGMENTS, Math.min(MAX_ROUTE_SEGMENTS, Math.ceil(running))),
    lengthMeters,
  };
};

const detailProfile = (curve: THREE.CatmullRomCurve3): DetailProfile => {
  const cached = profileCache.get(curve);
  if (cached) return cached;
  const built = buildDetailProfile(curve);
  profileCache.set(curve, built);
  return built;
};

/** Cost accumulated by progress `at`, linearly interpolated between probes. */
const costAt = (profile: DetailProfile, at: number): number => {
  const { t, cost } = profile;
  const clamped = Math.max(0, Math.min(1, at));
  const scaled = clamped * (t.length - 1);
  const lower = Math.min(t.length - 2, Math.floor(scaled));
  const blend = scaled - lower;
  return cost[lower] + (cost[lower + 1] - cost[lower]) * blend;
};

/** Progress at which the profile reaches `target` cost. */
const progressAtCost = (profile: DetailProfile, target: number): number => {
  const { t, cost } = profile;
  let low = 0;
  let high = cost.length - 1;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (cost[mid] < target) low = mid + 1;
    else high = mid;
  }
  if (low === 0) return t[0];
  const span = cost[low] - cost[low - 1];
  const blend = span > 0 ? (target - cost[low - 1]) / span : 0;
  return t[low - 1] + (t[low] - t[low - 1]) * blend;
};

/**
 * Progress values to sample when building a strip across `range`.
 *
 * Samples sit at equal increments of detail cost rather than equal distance, so
 * a bend gets the geometry its curvature earns. The first and last entries are
 * `range.from` and `range.to` verbatim, so the chunk starting at that boundary
 * samples bit-identical `t` and the two strips meet with no seam.
 */
export const stripProgressSchedule = (
  curve: THREE.CatmullRomCurve3,
  range: ProgressRange = WHOLE_ROUTE,
): number[] => {
  const profile = detailProfile(curve);
  const startCost = costAt(profile, range.from);
  const endCost = costAt(profile, range.to);
  const total = profile.cost[profile.cost.length - 1];

  const share = total > 0 ? (endCost - startCost) / total : range.to - range.from;
  const wanted = Math.max(1, Math.round(profile.segments * share));

  // Never subdivide below what the eye could resolve: a route metre buys at
  // most two segments, however hard that stretch turns.
  const rangeMeters = profile.lengthMeters * (range.to - range.from);
  const segments = Math.max(
    1,
    Math.min(wanted, Math.floor(rangeMeters / MIN_SEGMENT_METERS) || 1),
  );

  const schedule = new Array<number>(segments + 1);
  schedule[0] = range.from;
  for (let i = 1; i < segments; i++) {
    schedule[i] = progressAtCost(profile, startCost + ((endCost - startCost) * i) / segments);
  }
  schedule[segments] = range.to;
  return schedule;
};

/** Segments a strip spans across `range`. */
export const stripSegmentCount = (
  curve: THREE.CatmullRomCurve3,
  range: ProgressRange = WHOLE_ROUTE,
): number => stripProgressSchedule(curve, range).length - 1;
