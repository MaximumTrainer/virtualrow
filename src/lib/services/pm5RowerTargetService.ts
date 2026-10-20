/**
 * Stub PM5 (Concept2) implementation of {@link import('../ports').RowerTargetPort}
 * (#445).
 *
 * The full path — CSAFE `SetWorkout` frames to a connected PM5 — needs
 * frame-level unit tests against the vendored `pm5-base` and is a dedicated
 * follow-up (D3(a), NFR5). Until then, `setTargets` records nothing on the
 * wire; it logs once per process so a curious dev sees why the PM5 is not
 * responding to prescribed targets, and returns silently thereafter.
 */
import type { RowerTargets } from './simulatorRowerTargetService';

export class Pm5RowerTargetService {
  private warned = false;

  setTargets(_targets: RowerTargets): void {
    if (!this.warned) {
      console.warn('PM5 target writes not yet implemented');
      this.warned = true;
    }
  }

  /** Test helper: forget the one-shot warn state so the next call warns again. */
  resetWarnState(): void {
    this.warned = false;
  }
}

export const pm5RowerTargetService = new Pm5RowerTargetService();
