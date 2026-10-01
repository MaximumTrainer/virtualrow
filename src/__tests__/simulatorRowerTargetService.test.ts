import { describe, it, expect, beforeEach } from 'vitest';
import { SimulatorRowerTargetService } from '../services/simulatorRowerTargetService';

describe('SimulatorRowerTargetService (#445)', () => {
  let svc: SimulatorRowerTargetService;
  beforeEach(() => {
    svc = new SimulatorRowerTargetService();
  });

  it('starts with no targets and a speed factor of 1', () => {
    expect(svc.getTargets()).toEqual({});
    expect(svc.speedFactor(120)).toBe(1);
  });

  it('setTargets stores a copy so the caller cannot mutate our state', () => {
    const t = { paceSecondsPer500: 111, powerWatts: 200 };
    svc.setTargets(t);
    t.paceSecondsPer500 = 200;
    expect(svc.getTargets()).toEqual({ paceSecondsPer500: 111, powerWatts: 200 });
  });

  it('speedFactor is currentPace / targetPace when the target is faster', () => {
    svc.setTargets({ paceSecondsPer500: 110 });
    // current 120 s/500m, target 110 s/500m → want the rower going faster
    expect(svc.speedFactor(120)).toBeCloseTo(120 / 110, 4);
  });

  it('speedFactor is clamped to [0.9, 1.1]', () => {
    svc.setTargets({ paceSecondsPer500: 50 });
    expect(svc.speedFactor(120)).toBe(1.1);
    svc.setTargets({ paceSecondsPer500: 300 });
    expect(svc.speedFactor(120)).toBe(0.9);
  });

  it('returns 1 when the current pace is unknown or non-positive', () => {
    svc.setTargets({ paceSecondsPer500: 110 });
    expect(svc.speedFactor(undefined)).toBe(1);
    expect(svc.speedFactor(0)).toBe(1);
    expect(svc.speedFactor(-5)).toBe(1);
  });

  it('returns 1 when there is no pace target, even with a power target set', () => {
    svc.setTargets({ powerWatts: 250 });
    expect(svc.speedFactor(120)).toBe(1);
  });

  it('notifies subscribers on setTargets and stops after unsubscribe', () => {
    const seen: unknown[] = [];
    const off = svc.subscribe((t) => seen.push({ ...t }));
    svc.setTargets({ paceSecondsPer500: 111 });
    svc.setTargets({ powerWatts: 220 });
    off();
    svc.setTargets({ paceSecondsPer500: 105 });
    expect(seen).toEqual([{ paceSecondsPer500: 111 }, { powerWatts: 220 }]);
  });

  it('reset() clears state and listeners', () => {
    let calls = 0;
    svc.subscribe(() => calls++);
    svc.setTargets({ paceSecondsPer500: 111 });
    svc.reset();
    expect(svc.getTargets()).toEqual({});
    svc.setTargets({ paceSecondsPer500: 110 });
    expect(calls).toBe(1); // only the pre-reset call
  });
});
