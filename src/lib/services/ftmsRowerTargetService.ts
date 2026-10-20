/**
 * Stub FTMS implementation of {@link import('../ports').RowerTargetPort} (#445).
 *
 * The full path — writing FTMS Control Point 0x2AD9 (Set Target Power / Set
 * Target Pace / Set Targeted Resistance Level) to a connected erg — is a
 * dedicated follow-up (out of scope in #445, per D3(a) and NFR5). Until that
 * work lands, `setTargets` records nothing on the wire; it logs once per
 * process so a curious dev sees why the erg is not responding to prescribed
 * targets, and returns silently thereafter.
 */
import type { RowerTargets } from './simulatorRowerTargetService';

export class FtmsRowerTargetService {
  private warned = false;

  setTargets(_targets: RowerTargets): void {
    if (!this.warned) {
      console.warn('FTMS target writes not yet implemented');
      this.warned = true;
    }
  }

  /** Test helper: forget the one-shot warn state so the next call warns again. */
  resetWarnState(): void {
    this.warned = false;
  }
}

export const ftmsRowerTargetService = new FtmsRowerTargetService();
