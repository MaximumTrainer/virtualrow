import { describe, it, expect, beforeEach } from 'vitest';
import { checkBootCrash, reportFromErrorBoundary } from '../lib/utils/crashBoot';
import {
  openTelemetry,
  clearTelemetry,
  TELEMETRY_STORAGE_KEY,
} from '../lib/utils/sceneTelemetryLog';
import type { CrashReporterPort } from '../lib/ports';

/**
 * The boot wiring (FR1) and the error-boundary helper (FR2) tested without a
 * browser: they are pure functions over the recovered log plus a port.
 */

const makeReporter = (): {
  reporter: CrashReporterPort;
  calls: Array<Parameters<CrashReporterPort['reportCrash']>[0]>;
} => {
  const calls: Array<Parameters<CrashReporterPort['reportCrash']>[0]> = [];
  const reporter: CrashReporterPort = {
    reportCrash: async (payload) => {
      calls.push(payload);
      return { submitted: true };
    },
    getLastSubmissionError: () => null,
    getSessionId: () => 'test-session',
  };
  return { reporter, calls };
};

const syncSchedule = (callback: () => void): void => callback();

describe('crashBoot (#473 Phase 2 FR1)', () => {
  beforeEach(() => {
    clearTelemetry();
    sessionStorage.clear();
  });

  it('does nothing when there is no recovered telemetry', () => {
    openTelemetry(sessionStorage); // records one run-start
    const { reporter, calls } = makeReporter();
    checkBootCrash(reporter, { schedule: syncSchedule });
    expect(calls).toHaveLength(0);
  });

  it('reports a crash when the previous run reloaded without a page-hide (AC1)', () => {
    // Simulate a previous run: a run-start plus a scene lifecycle event, no
    // page-hide. Then openTelemetry recovers it and appends a fresh run-start.
    sessionStorage.setItem(
      TELEMETRY_STORAGE_KEY,
      JSON.stringify([
        { at: 10, kind: 'run-start', detail: { recovered: 0 } },
        { at: 1000, kind: 'error', detail: { message: 'kaboom', source: 'file.js:10:1' } },
      ]),
    );
    openTelemetry(sessionStorage);

    const { reporter, calls } = makeReporter();
    checkBootCrash(reporter, { schedule: syncSchedule, buildSha: 'deadbee' });

    expect(calls).toHaveLength(1);
    const payload = calls[0]!;
    expect(payload.verdict?.crashed).toBe(true);
    expect(payload.buildSha).toBe('deadbee');
    expect(payload.errorSummary?.message).toBe('kaboom');
    expect(payload.errorSummary?.firstFrame).toBe('file.js:10:1');
    expect(payload.telemetryText).toContain('error');
  });

  it('does nothing when the previous run said goodbye tidily', () => {
    sessionStorage.setItem(
      TELEMETRY_STORAGE_KEY,
      JSON.stringify([
        { at: 10, kind: 'run-start' },
        { at: 500, kind: 'page-hide' },
      ]),
    );
    openTelemetry(sessionStorage);

    const { reporter, calls } = makeReporter();
    checkBootCrash(reporter, { schedule: syncSchedule });
    expect(calls).toHaveLength(0);
  });

  it('swallows reporter failures (NFR2)', () => {
    sessionStorage.setItem(
      TELEMETRY_STORAGE_KEY,
      JSON.stringify([{ at: 10, kind: 'run-start' }]),
    );
    openTelemetry(sessionStorage);

    const reporter: CrashReporterPort = {
      reportCrash: () => {
        throw new Error('reporter blew up');
      },
      getLastSubmissionError: () => null,
      getSessionId: () => 'test',
    };
    expect(() => checkBootCrash(reporter, { schedule: syncSchedule })).not.toThrow();
  });
});

describe('reportFromErrorBoundary (#473 Phase 2 FR2)', () => {
  beforeEach(() => {
    clearTelemetry();
    sessionStorage.clear();
  });

  it('reports with the thrown error message and boundary name (AC2)', async () => {
    const { reporter, calls } = makeReporter();
    const error = new Error('component blew up');
    reportFromErrorBoundary(
      reporter,
      error,
      { componentStack: '  at Rower3D\n  at Canvas' },
      { boundary: 'Canvas3D', buildSha: 'cafef00d' },
    );

    // The helper defers through queueMicrotask.
    await Promise.resolve();
    await Promise.resolve();

    expect(calls).toHaveLength(1);
    const payload = calls[0]!;
    expect(payload.errorSummary?.message).toBe('component blew up');
    expect(payload.errorSummary?.firstFrame).toBe('at Rower3D');
    expect(payload.verdict?.reason).toContain('Canvas3D');
    expect(payload.buildSha).toBe('cafef00d');
  });

  it('never throws, even when the reporter does (NFR2)', () => {
    const reporter: CrashReporterPort = {
      reportCrash: () => {
        throw new Error('nope');
      },
      getLastSubmissionError: () => null,
      getSessionId: () => 'x',
    };
    expect(() =>
      reportFromErrorBoundary(
        reporter,
        new Error('x'),
        { componentStack: null },
        { boundary: 'scene content' },
      ),
    ).not.toThrow();
  });
});
