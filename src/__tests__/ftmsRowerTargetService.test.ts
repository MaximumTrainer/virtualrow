import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { FtmsRowerTargetService } from '../services/ftmsRowerTargetService';

describe('FtmsRowerTargetService (#445, D3(a) / NFR5 / AC9)', () => {
  let svc: FtmsRowerTargetService;
  let warn: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    svc = new FtmsRowerTargetService();
    warn = vi.fn();
    vi.spyOn(console, 'warn').mockImplementation(warn);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('logs exactly one warning across many setTargets calls in a session', () => {
    svc.setTargets({ paceSecondsPer500: 111 });
    svc.setTargets({ powerWatts: 200 });
    svc.setTargets({ paceSecondsPer500: 108, powerWatts: 220 });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith('FTMS target writes not yet implemented');
  });

  it('never emits any BLE-side effect (setTargets returns void; no throws)', () => {
    // Structural gate: setTargets is documented as a stub. If it ever grows a
    // BLE write, the review has to update this test AND `AC9` in #445.
    expect(() => svc.setTargets({ paceSecondsPer500: 111 })).not.toThrow();
    expect(svc.setTargets({ paceSecondsPer500: 111 })).toBeUndefined();
  });

  it('resetWarnState re-arms the one-shot warn (test-helper contract)', () => {
    svc.setTargets({ powerWatts: 200 });
    svc.resetWarnState();
    svc.setTargets({ powerWatts: 220 });
    expect(warn).toHaveBeenCalledTimes(2);
  });
});
