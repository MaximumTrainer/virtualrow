/**
 * Simulator implementation of {@link import('../ports').RowerTargetPort} (#445).
 *
 * Records the currently-active pace / power / resistance target for the
 * simulator's physics hook to read back on each frame. `speedFactor(currentPace)`
 * turns the stored target pace into a multiplier applied to the athlete's
 * current pace: `factor = currentPace / targetPace`, so a slower current pace
 * (higher seconds/500m) produces a factor > 1 that speeds the simulator up
 * toward the target. The controller (`useWorkoutTargetController`) is the one
 * that already clamps the setpoint to ±10 % of the athlete's current pace per
 * D8(a), so the factor here is bounded by construction; the extra clamp below
 * is belt-and-braces against a caller that skipped the controller.
 *
 * FTMS / PM5 hardware get their own port implementations that stub out the
 * write; a follow-up issue wires FTMS 0x2AD9 and CSAFE without touching
 * consumers.
 */
export interface RowerTargets {
  paceSecondsPer500?: number;
  powerWatts?: number;
  resistance?: number;
}

export type RowerTargetListener = (targets: RowerTargets) => void;

const NO_TARGETS: RowerTargets = {};

/** Belt-and-braces clamp: same ±10 % the controller already applies (D8(a)). */
const clampFactor = (factor: number): number => {
  if (!Number.isFinite(factor) || factor <= 0) return 1;
  return Math.min(1.1, Math.max(0.9, factor));
};

export class SimulatorRowerTargetService {
  private targets: RowerTargets = NO_TARGETS;
  private readonly listeners = new Set<RowerTargetListener>();

  setTargets(targets: RowerTargets): void {
    // Copy so a caller mutating its own object cannot mutate ours.
    this.targets = { ...targets };
    for (const listener of this.listeners) listener(this.targets);
  }

  getTargets(): RowerTargets {
    return this.targets;
  }

  /**
   * Multiplier applied to the athlete's current pace to drive the simulator
   * toward the stored target. Returns 1 when there is no pace target, or when
   * either pace is missing / non-positive.
   */
  speedFactor(currentPaceSecondsPer500: number | undefined): number {
    const target = this.targets.paceSecondsPer500;
    if (target === undefined || target <= 0) return 1;
    if (currentPaceSecondsPer500 === undefined || currentPaceSecondsPer500 <= 0) return 1;
    return clampFactor(currentPaceSecondsPer500 / target);
  }

  subscribe(listener: RowerTargetListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Test helper: forget any recorded target and drop subscribers. */
  reset(): void {
    this.targets = NO_TARGETS;
    this.listeners.clear();
  }
}

export const simulatorRowerTargetService = new SimulatorRowerTargetService();
