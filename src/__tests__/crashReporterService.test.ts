import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  CRASH_DEDUP_KEY,
  CRASH_SESSION_ID_KEY,
  CrashReporterService,
  buildSignature,
  DAILY_CAP,
} from '../services/crashReporterService';
import {
  CrashReportsPreferenceStore,
  CRASH_REPORTS_ENABLED_KEY,
} from '../services/crashReportsPreferenceStore';
import type { CrashPayload } from '../types/crashPayload';

/**
 * Unit tests for the crash reporter port + service (#473, FR3 / FR7 / FR8 /
 * FR10, AC3 / AC7 / AC8 / AC11). The real transport lands in Phase 3; here
 * every test uses a plain object stub.
 */

const basePayload = (over: Partial<CrashPayload> = {}): Partial<CrashPayload> => ({
  sessionId: 'sess-1',
  buildSha: 'abc1234',
  occurredAt: '2026-10-12T20:00:00Z',
  verdict: { crashed: true, reason: 'the renderer process crashed' },
  userAgent: 'Mozilla/5.0 (test)',
  viewport: { w: 1024, h: 768, dpr: 2 },
  performanceMode: 'high',
  errorSummary: { message: 'boom', firstFrame: 'at crash' },
  telemetryText: 'nothing to redact',
  intervalsIcuAthleteId: null,
  ...over,
});

describe('crashReporterService (#473)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('exposes a port a plain-object stub satisfies (AC3)', () => {
    // The port is the method surface. A test double is a plain object:
    const stub: {
      reportCrash: CrashReporterService['reportCrash'];
      getLastSubmissionError: CrashReporterService['getLastSubmissionError'];
    } = {
      reportCrash: async () => ({ submitted: false }),
      getLastSubmissionError: () => null,
    };
    expect(typeof stub.reportCrash).toBe('function');
    expect(typeof stub.getLastSubmissionError).toBe('function');
  });

  it('submits exactly one call for a first-ever crash and marks the dedup entry', async () => {
    const transport = vi.fn().mockResolvedValue(undefined);
    const svc = new CrashReporterService({
      transport,
      preferences: new CrashReportsPreferenceStore(),
      nowFn: () => 1_000_000,
    });

    const result = await svc.reportCrash(basePayload());
    expect(result.submitted).toBe(true);
    expect(transport).toHaveBeenCalledTimes(1);

    const dedup = JSON.parse(localStorage.getItem(CRASH_DEDUP_KEY) ?? '{}');
    expect(Object.keys(dedup)).toHaveLength(1);
    expect(Object.values(dedup)[0]).toBe(1_000_000);
  });

  it('drops a duplicate within one hour (FR7, AC7)', async () => {
    const transport = vi.fn().mockResolvedValue(undefined);
    let clock = 1_000_000;
    const svc = new CrashReporterService({
      transport,
      preferences: new CrashReportsPreferenceStore(),
      nowFn: () => clock,
    });

    const first = await svc.reportCrash(basePayload());
    clock += 30 * 60 * 1000;
    const second = await svc.reportCrash(basePayload());

    expect(first.submitted).toBe(true);
    expect(second.submitted).toBe(false);
    expect(second.reason).toBe('duplicate-within-window');
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('enforces the 24h cap across distinct signatures (FR7, AC7)', async () => {
    const transport = vi.fn().mockResolvedValue(undefined);
    const prefs = new CrashReportsPreferenceStore();
    let clock = 1_000_000;
    const svc = new CrashReporterService({
      transport,
      preferences: prefs,
      nowFn: () => clock,
    });

    for (let i = 0; i < DAILY_CAP + 1; i += 1) {
      clock += 60 * 1000; // one minute apart, distinct signatures
      await svc.reportCrash(basePayload({
        errorSummary: { message: `boom ${i}`, firstFrame: `frame ${i}` },
      }));
    }

    expect(transport).toHaveBeenCalledTimes(DAILY_CAP);
  });

  it('is a no-op when the opt-out is off (AC8)', async () => {
    localStorage.setItem(CRASH_REPORTS_ENABLED_KEY, 'false');
    const transport = vi.fn().mockResolvedValue(undefined);
    const svc = new CrashReporterService({
      transport,
      preferences: new CrashReportsPreferenceStore(),
    });

    const result = await svc.reportCrash(basePayload());
    expect(result.submitted).toBe(false);
    expect(result.reason).toBe('opted-out');
    expect(transport).not.toHaveBeenCalled();
  });

  it('does not throw on a transport reject (NFR2)', async () => {
    const transport = vi.fn().mockRejectedValue(new Error('network dead'));
    const svc = new CrashReporterService({
      transport,
      preferences: new CrashReportsPreferenceStore(),
    });

    const result = await svc.reportCrash(basePayload());
    expect(result.submitted).toBe(false);
    expect(svc.getLastSubmissionError()).toBe('network dead');
  });

  it('does not throw on a redactor-exploding payload (NFR2)', async () => {
    const transport = vi.fn().mockResolvedValue(undefined);
    const svc = new CrashReporterService({
      transport,
      preferences: new CrashReportsPreferenceStore(),
    });
    // A cyclic structure would blow up a JSON stringify; the service must
    // still return a result without throwing.
    const cyclic: Record<string, unknown> = { verdict: { crashed: true, reason: 'r' } };
    cyclic.self = cyclic;
    await expect(
      svc.reportCrash(cyclic as unknown as Partial<CrashPayload>),
    ).resolves.toEqual(expect.objectContaining({ submitted: expect.any(Boolean) }));
  });

  it('lazily persists the opaque sessionId on first use (FR4)', async () => {
    const transport = vi.fn().mockResolvedValue(undefined);
    const svc = new CrashReporterService({
      transport,
      preferences: new CrashReportsPreferenceStore(),
    });
    expect(localStorage.getItem(CRASH_SESSION_ID_KEY)).toBeNull();
    const id = svc.getSessionId();
    expect(id.length).toBeGreaterThan(0);
    expect(localStorage.getItem(CRASH_SESSION_ID_KEY)).toBe(id);
    expect(svc.getSessionId()).toBe(id);
  });

  it('skips the real transport when no endpoint is configured (FR5)', async () => {
    const transport = vi.fn().mockResolvedValue(undefined);
    const svc = new CrashReporterService({
      transport,
      preferences: new CrashReportsPreferenceStore(),
      endpoint: null,
    });
    const result = await svc.reportCrash(basePayload());
    expect(result.submitted).toBe(false);
    expect(result.reason).toBe('no-endpoint');
    expect(transport).not.toHaveBeenCalled();
  });

  it('derives a stable signature from message + frame + UA prefix', () => {
    const sig = buildSignature({
      errorSummary: { message: 'cannot read x', firstFrame: 'at useFrame' },
      userAgent: 'Mozilla/5.0 (X11; Linux)',
    });
    expect(sig).toBe('cannot read x|at useFrame|Mozilla/5.0');
  });
});
