/**
 * Real-time control loop that drives the current workout block's prescribed
 * targets into whatever rower source is active (issue #445, FR5).
 *
 * Contract (D8(a), D9(a)):
 * - Setpoint is the midpoint of the current block's pace band. If the block
 *   only has a power target, the pace field is left off and the port
 *   implementation decides what to do with `powerWatts` alone.
 * - The pace setpoint is saturated to ±10 % of the athlete's live pace before
 *   it reaches the port, so a runaway target (a walking-pace warmup after a
 *   sprint) cannot spike the simulator's speed factor beyond 1.10.
 * - Writes are throttled to 5 Hz (200 ms) — the panel refreshes every frame
 *   but the port sees at most five updates per second.
 * - A block with no `targetPaceMin/Max` AND no `targetPowerWatts` triggers no
 *   `setTargets` call; the panel shows "No target" for that block.
 *
 * The port is passed in rather than resolved from `useServices()` so a test
 * can swap in a stub without going through a ServicesProvider (AC8).
 */
import { useEffect, useRef } from 'react';
import type { RowerTargetPort } from '../ports';
import type { WorkoutSegment } from '../types';

const MIN_INTERVAL_MS = 200; // 5 Hz
const SATURATION = 0.1; // ±10 % per D8(a)

export interface WorkoutTargetControllerInputs {
  /** The block whose targets the controller drives. */
  segment: WorkoutSegment | null | undefined;
  /**
   * Current pace of the athlete in seconds per 500 m, used both as the
   * anchor for the ±10 % saturation and to detect that the athlete has not
   * yet started rowing (undefined or non-positive → no write).
   */
  currentPaceSecondsPer500: number | undefined;
  /** The rower-target port to write into (simulator, FTMS stub, or PM5 stub). */
  rowerTargets: RowerTargetPort;
  /** Whether the row stage is mounted; controller pauses when false. */
  active: boolean;
  /**
   * Optional clock override so tests can drive the throttle deterministically.
   * Defaults to `performance.now`.
   */
  now?: () => number;
}

export function segmentHasControllableTarget(segment: WorkoutSegment | null | undefined): boolean {
  if (!segment) return false;
  return (
    typeof segment.targetPower === 'number' ||
    typeof segment.targetPaceMin === 'number' ||
    typeof segment.targetPaceMax === 'number'
  );
}

/**
 * Compute the saturated setpoint the port should see this tick. Returns
 * `null` when the block has no controllable target so the caller can skip the
 * write entirely (D9(a)).
 */
export function computeTargetPayload(
  segment: WorkoutSegment | null | undefined,
  currentPaceSecondsPer500: number | undefined,
): { paceSecondsPer500?: number; powerWatts?: number } | null {
  if (!segmentHasControllableTarget(segment)) return null;
  const payload: { paceSecondsPer500?: number; powerWatts?: number } = {};
  if (typeof segment!.targetPower === 'number') {
    payload.powerWatts = segment!.targetPower;
  }
  const paceMin = segment!.targetPaceMin;
  const paceMax = segment!.targetPaceMax;
  if (typeof paceMin === 'number' && typeof paceMax === 'number') {
    const midpoint = (paceMin + paceMax) / 2;
    if (typeof currentPaceSecondsPer500 === 'number' && currentPaceSecondsPer500 > 0) {
      const lower = currentPaceSecondsPer500 * (1 - SATURATION);
      const upper = currentPaceSecondsPer500 * (1 + SATURATION);
      payload.paceSecondsPer500 = Math.min(upper, Math.max(lower, midpoint));
    } else {
      payload.paceSecondsPer500 = midpoint;
    }
  }
  if (payload.paceSecondsPer500 === undefined && payload.powerWatts === undefined) {
    return null;
  }
  return payload;
}

export function useWorkoutTargetController({
  segment,
  currentPaceSecondsPer500,
  rowerTargets,
  active,
  now = () => performance.now(),
}: WorkoutTargetControllerInputs): void {
  const lastCallAtRef = useRef<number>(-Infinity);
  const lastSegmentIdRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!active) {
      lastCallAtRef.current = -Infinity;
      lastSegmentIdRef.current = undefined;
      return;
    }
    // A new block resets the throttle so the first frame of a new segment
    // writes its target immediately, even if the previous segment wrote 20 ms
    // ago.
    if (segment?.id !== lastSegmentIdRef.current) {
      lastCallAtRef.current = -Infinity;
      lastSegmentIdRef.current = segment?.id;
    }
    const payload = computeTargetPayload(segment, currentPaceSecondsPer500);
    if (payload === null) return;
    const t = now();
    if (t - lastCallAtRef.current < MIN_INTERVAL_MS) return;
    lastCallAtRef.current = t;
    rowerTargets.setTargets(payload);
  }, [active, segment, currentPaceSecondsPer500, rowerTargets, now]);
}
