import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CrashReporterService, RETRY_DELAYS_MS } from '../services/crashReporterService';
import { CrashReportsPreferenceStore } from '../services/crashReportsPreferenceStore';
import type { CrashPayload } from '../types/crashPayload';

/**
 * Unit tests for the FR10 retry schedule.
 *
 * The schedule is {0, 2s, 6s}: one attempt + two retries. The reporter
 * swallows the final failure, records the message in
 * `getLastSubmissionError`, and does not persist the payload — a point-in-
 * time crash report that posts a day late would be noise.
 */

const basePayload = (): Partial<CrashPayload> => ({
  sessionId: 'sess-r1',
  buildSha: 'abc1234',
  occurredAt: '2026-10-13T20:00:00Z',
  verdict: { crashed: true, reason: 'kaboom' },
  userAgent: 'Mozilla/5.0 (test)',
  viewport: { w: 1024, h: 768, dpr: 2 },
  performanceMode: 'high',
  errorSummary: { message: 'boom', firstFrame: 'at line 1' },
  telemetryText: '',
  intervalsIcuAthleteId: null,
});

describe('CrashReporterService — FR10 retries', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('exposes a two-step retry schedule at 2s and 6s', () => {
    expect(RETRY_DELAYS_MS).toEqual([2_000, 6_000]);
  });

  it('retries the transport twice on failure and sleeps between attempts', async () => {
    const transport = vi.fn().mockRejectedValue(new Error('503'));
    const sleepFn = vi.fn().mockResolvedValue(undefined);
    const svc = new CrashReporterService({
      transport,
      preferences: new CrashReportsPreferenceStore(),
      nowFn: () => 1_000,
      sleepFn,
    });

    const result = await svc.reportCrash(basePayload());

    expect(transport).toHaveBeenCalledTimes(3);
    expect(sleepFn).toHaveBeenCalledTimes(2);
    expect(sleepFn.mock.calls.map((c) => c[0])).toEqual([2_000, 6_000]);
    expect(result.submitted).toBe(false);
    expect(svc.getLastSubmissionError()).toBe('503');
  });

  it('stops retrying as soon as a retry succeeds', async () => {
    const transport = vi
      .fn()
      .mockRejectedValueOnce(new Error('first'))
      .mockResolvedValueOnce(undefined);
    const sleepFn = vi.fn().mockResolvedValue(undefined);
    const svc = new CrashReporterService({
      transport,
      preferences: new CrashReportsPreferenceStore(),
      nowFn: () => 1_000,
      sleepFn,
    });

    const result = await svc.reportCrash(basePayload());

    expect(transport).toHaveBeenCalledTimes(2);
    expect(sleepFn).toHaveBeenCalledTimes(1);
    expect(result.submitted).toBe(true);
    expect(svc.getLastSubmissionError()).toBeNull();
  });

  it('never throws through a failing transport (NFR2)', async () => {
    const transport = vi.fn().mockRejectedValue(new Error('nope'));
    const sleepFn = vi.fn().mockResolvedValue(undefined);
    const svc = new CrashReporterService({
      transport,
      preferences: new CrashReportsPreferenceStore(),
      nowFn: () => 1_000,
      sleepFn,
      retryDelaysMs: [],
    });

    await expect(svc.reportCrash(basePayload())).resolves.toEqual(
      expect.objectContaining({ submitted: false }),
    );
  });
});
