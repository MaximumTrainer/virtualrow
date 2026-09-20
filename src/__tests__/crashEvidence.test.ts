import { describe, it, expect } from 'vitest';
import { describeCrashEvidence } from '../utils/crashEvidence';
import type { TelemetryEvent } from '../utils/sceneTelemetryLog';

/**
 * A renderer that dies during a spec can leave that spec passing. Two of the
 * twenty-eight specs watch for it, and both would have missed #301 — the one
 * tab death this repository has seen raised no `crash` event, because the
 * browser killed the renderer and restored the tab.
 *
 * The rule lives here as a pure function for the same reason describeSceneHealth
 * does: so it can be tested without a browser, and so the guard that applies it
 * cannot drift from the rule itself.
 */

const at = (() => {
  let clock = 0;
  return () => {
    clock += 100;
    return clock;
  };
})();

const log = (...kinds: Array<string | TelemetryEvent>): TelemetryEvent[] =>
  kinds.map((kind) => (typeof kind === 'string' ? { at: at(), kind } : kind));

describe('describeCrashEvidence', () => {
  it('reports a renderer process that crashed outright', () => {
    const verdict = describeCrashEvidence({
      crashEventFired: true,
      events: log('run-start'),
    });

    expect(verdict.crashed).toBe(true);
    expect(verdict.reason).toBe('the renderer process crashed');
  });

  it('reports a kill-and-reload, which raises no crash event at all', () => {
    // The #301 shape: the tab came back without ever saying it was going.
    const verdict = describeCrashEvidence({
      crashEventFired: false,
      events: log('run-start', 'context-created', 'sample', 'sample', 'run-start'),
    });

    expect(verdict.crashed).toBe(true);
    expect(verdict.reason).toBe(
      'the page reloaded without a page-hide: the renderer was killed and the tab restored',
    );
  });

  it('leaves a deliberate reload alone', () => {
    // scene-telemetry.spec.ts reloads on purpose, and must not be failed for it.
    const verdict = describeCrashEvidence({
      crashEventFired: false,
      events: log('run-start', 'context-created', 'sample', 'page-hide', 'run-start'),
    });

    expect(verdict.crashed).toBe(false);
    expect(verdict.reason).toBe('the page reloaded tidily');
  });

  it('leaves one clean run alone', () => {
    const verdict = describeCrashEvidence({
      crashEventFired: false,
      events: log('run-start', 'context-created', 'sample', 'sample'),
    });

    expect(verdict.crashed).toBe(false);
  });

  it('says nothing about a spec that never reached the app', () => {
    // auth.spec.ts and intervals-login.spec.ts never start a scene. A guard
    // that failed those would be taken out again within the week.
    const verdict = describeCrashEvidence({ crashEventFired: false, events: [] });

    expect(verdict.crashed).toBe(false);
    expect(verdict.reason).toBe('no telemetry was recorded');
  });

  it('judges every reload, not only the last one', () => {
    // A tidy reload followed by a kill: reading the last pair alone would call
    // this clean, and reading the first alone would too.
    const verdict = describeCrashEvidence({
      crashEventFired: false,
      events: log(
        'run-start',
        'page-hide',
        'run-start',
        'context-created',
        'run-start',
        'context-created',
      ),
    });

    expect(verdict.crashed).toBe(true);
  });

  it('accepts a run of tidy reloads', () => {
    const verdict = describeCrashEvidence({
      crashEventFired: false,
      events: log(
        'run-start',
        'page-hide',
        'run-start',
        'page-hide',
        'run-start',
        'page-hide',
        'run-start',
      ),
    });

    expect(verdict.crashed).toBe(false);
  });

  it('believes the crash event over a tidy-looking log', () => {
    // A renderer can die after a tidy reload. The process signal wins.
    const verdict = describeCrashEvidence({
      crashEventFired: true,
      events: log('run-start', 'page-hide', 'run-start'),
    });

    expect(verdict.crashed).toBe(true);
    expect(verdict.reason).toBe('the renderer process crashed');
  });
});
