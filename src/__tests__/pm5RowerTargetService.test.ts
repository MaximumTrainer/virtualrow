import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Pm5RowerTargetService } from '../services/pm5RowerTargetService';

describe('Pm5RowerTargetService (#445, D3(a) / NFR5 / AC9)', () => {
  let svc: Pm5RowerTargetService;
  let warn: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    svc = new Pm5RowerTargetService();
    warn = vi.fn();
    vi.spyOn(console, 'warn').mockImplementation(warn);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('logs exactly one warning across many setTargets calls in a session', () => {
    svc.setTargets({ paceSecondsPer500: 111 });
    svc.setTargets({ powerWatts: 200 });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith('PM5 target writes not yet implemented');
  });

  it('never emits any BLE-side effect (setTargets returns void; no throws)', () => {
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
