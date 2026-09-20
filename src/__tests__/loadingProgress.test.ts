import { describe, it, expect } from 'vitest';
import {
  LOAD_PHASES,
  describeLoadProgress,
  type LoadPhaseKey,
} from '../utils/loadingProgress';

/**
 * How much of the wait is done (#318).
 *
 * The stage used to show one line of static text, dismissed when the *code
 * chunk* resolved. Measured on the demo route, built app, software rasteriser:
 *
 *   0 ms      "Loading 3D view…" shown, Rower3D chunk requested
 *   ~690 ms   chunk arrives (1,145 kB) — and the message goes
 *   ~1,294 ms route geometry ready
 *   ~1,335 ms first frame
 *   ~3,247 ms scull-male.glb finishes (1,960 kB)
 *
 * So the rower was told the wait was over at 0.7 s and it ended at 3.2 s, with
 * the single largest download happening after the message had gone.
 *
 * The rule lives here as a pure function, like describeSceneHealth and
 * describeCrashEvidence: testable without a browser, and it cannot drift from
 * the component that renders it.
 */

const done = (...keys: LoadPhaseKey[]) => new Set<LoadPhaseKey>(keys);

describe('the phases of a route load', () => {
  it('are worth 100 between them', () => {
    // Anything else and the bar cannot reach its own end.
    const total = LOAD_PHASES.reduce((sum, phase) => sum + phase.weight, 0);
    expect(total).toBe(100);
  });

  it('are worth roughly what they cost the rower', () => {
    // Measured shares of a 3,247 ms wait: view 21%, scene 19%, frame 1%,
    // boat 59%. The boat is the largest by far and must not be a token sliver
    // at the end, which is what a four-equal-quarters bar would make it.
    const boat = LOAD_PHASES.find((p) => p.key === 'boat')!;
    expect(boat.weight).toBeGreaterThan(40);

    // And the frame, measured at 41 ms, must not be worth a quarter.
    const frame = LOAD_PHASES.find((p) => p.key === 'frame')!;
    expect(frame.weight).toBeLessThanOrEqual(10);
  });

  it('each say what they are, in words a rower would use', () => {
    for (const phase of LOAD_PHASES) {
      expect(phase.label.length, `${phase.key} has no label`).toBeGreaterThan(0);
      expect(phase.label, `${phase.key} reads like a variable name`).not.toMatch(/[_A-Z]{2,}/);
    }
  });
});

describe('describeLoadProgress', () => {
  it('starts at zero, naming the first thing it is waiting for', () => {
    const state = describeLoadProgress(done());

    expect(state.percent).toBe(0);
    expect(state.phase).toBe(LOAD_PHASES[0].label);
    expect(state.complete).toBe(false);
  });

  it('adds a phase only once it has finished', () => {
    const view = LOAD_PHASES.find((p) => p.key === 'view')!;

    expect(describeLoadProgress(done('view')).percent).toBe(view.weight);
  });

  it('names what it is waiting for now, not what it just finished', () => {
    const state = describeLoadProgress(done('view'));

    expect(state.phase).toBe(LOAD_PHASES[1].label);
  });

  it('reaches exactly 100 when every phase is done, and says so', () => {
    const state = describeLoadProgress(done(...LOAD_PHASES.map((p) => p.key)));

    expect(state.percent).toBe(100);
    expect(state.complete).toBe(true);
  });

  it('never reads 100 while anything is outstanding', () => {
    // The bar reaching its end before the scene is ready is the fault this
    // whole issue is about, in miniature.
    for (const phase of LOAD_PHASES) {
      const allButOne = LOAD_PHASES.filter((p) => p.key !== phase.key).map((p) => p.key);
      const state = describeLoadProgress(done(...allButOne));

      expect(state.percent, `${phase.key} outstanding and the bar read 100`).toBeLessThan(100);
      expect(state.complete).toBe(false);
    }
  });

  it('only ever moves forward as phases complete in order', () => {
    let previous = -1;
    const finished: LoadPhaseKey[] = [];

    for (const phase of LOAD_PHASES) {
      finished.push(phase.key);
      const { percent } = describeLoadProgress(done(...finished));
      expect(percent, `progress went backwards at ${phase.key}`).toBeGreaterThan(previous);
      previous = percent;
    }
  });

  it('counts a phase that finished out of order, rather than losing it', () => {
    // The boat can finish before the first frame on a warm cache. Progress is
    // the sum of what is done, not a pointer to how far along a list we are.
    const boat = LOAD_PHASES.find((p) => p.key === 'boat')!;

    expect(describeLoadProgress(done('boat')).percent).toBe(boat.weight);
  });

  it('is complete when a phase failed rather than finished', () => {
    // A boat that 503s must not leave the rower at 41% for ever. The row goes
    // on without it, so the wait is over (#266, #267 set the precedent).
    const state = describeLoadProgress(done('view', 'scene', 'frame'), done('boat'));

    expect(state.complete).toBe(true);
    expect(state.percent).toBe(100);
    expect(state.failed).toEqual(['boat']);
  });

  it('names a failed phase so the stage can explain it', () => {
    const state = describeLoadProgress(done(), done('boat'));

    expect(state.failed).toContain('boat');
  });

  it('does not count a failed phase twice', () => {
    const state = describeLoadProgress(done('boat'), done('boat'));

    expect(state.percent).toBeLessThanOrEqual(100);
  });

  it('ignores a key it does not know', () => {
    // Defensive: a renamed phase must not silently push the bar past its end.
    const state = describeLoadProgress(new Set(['nonsense'] as unknown as LoadPhaseKey[]));

    expect(state.percent).toBe(0);
  });
});
