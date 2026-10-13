import { describe, it, expect } from 'vitest';
import {
  PER_FIELD_MAX_BYTES,
  REDACTED,
  redactCrashPayload,
  redactText,
  truncateField,
} from '../utils/crashRedactor';
import { CRASH_PAYLOAD_SCHEMA_VERSION } from '../types/crashPayload';

/**
 * The redactor is the single path telemetry takes out of the browser
 * (issue #473, FR6 / NFR4 / AC6 / AC11). These tests pin the three regexes,
 * the allowlist (anything off-schema is dropped), and the truncation suffix.
 */
describe('crashRedactor', () => {
  describe('redactText', () => {
    it('replaces token-shaped runs with [REDACTED]', () => {
      const t = 'bearer ghp_abcdefghijklmnopqrstuvwxyz0123456789 end';
      expect(redactText(t)).toBe(`bearer ${REDACTED} end`);
    });

    it('replaces emails with [REDACTED]', () => {
      const t = 'from sandeater@gmail.com (owner)';
      expect(redactText(t)).toContain(REDACTED);
      expect(redactText(t)).not.toContain('sandeater');
      expect(redactText(t)).not.toContain('gmail.com');
    });

    it('replaces lat/lng pairs with [REDACTED]', () => {
      const t = 'position 51.5074, -0.1278 recorded';
      expect(redactText(t)).toBe(`position ${REDACTED} recorded`);
    });

    it('leaves short alphanumerics alone', () => {
      expect(redactText('fps=60 drawCalls=120 run-start')).toBe(
        'fps=60 drawCalls=120 run-start',
      );
    });
  });

  describe('truncateField', () => {
    it('leaves a short string untouched', () => {
      expect(truncateField('short')).toBe('short');
    });

    it('appends a suffix past the cap', () => {
      const big = 'x'.repeat(PER_FIELD_MAX_BYTES + 100);
      const out = truncateField(big);
      expect(out).toContain(`truncated at ${PER_FIELD_MAX_BYTES} B`);
      expect(out.startsWith('x')).toBe(true);
    });
  });

  describe('redactCrashPayload', () => {
    it('strips any field not on the schema (deep allowlist)', () => {
      // deliberately widened — the caller cannot sneak a field through
      const dirty = {
        schemaVersion: CRASH_PAYLOAD_SCHEMA_VERSION,
        sessionId: 'sess-123',
        buildSha: 'abc1234',
        occurredAt: '2026-10-12T20:00:00Z',
        verdict: { crashed: true, reason: 'r' },
        userAgent: 'Mozilla/5.0',
        viewport: { w: 1024, h: 768, dpr: 2 },
        performanceMode: 'high',
        errorSummary: { message: 'boom', firstFrame: null },
        telemetryText: 'ok',
        intervalsIcuAthleteId: '12345',
        // smuggled fields
        email: 'leaked@example.com',
        access_token: 'secret-token-value-abcdefghij',
        routeId: 'r1',
        lat: 51.5,
        lng: -0.12,
      } as unknown as Parameters<typeof redactCrashPayload>[0];
      const out = redactCrashPayload(dirty);
      const serialised = JSON.stringify(out);
      expect(serialised).not.toContain('email');
      expect(serialised).not.toContain('access_token');
      expect(serialised).not.toContain('routeId');
      expect(serialised).not.toContain('leaked@example.com');
      expect(out.sessionId).toBe('sess-123');
      expect(out.schemaVersion).toBe(CRASH_PAYLOAD_SCHEMA_VERSION);
    });

    it('redacts the worst-case fixture end-to-end (NFR4)', () => {
      const out = redactCrashPayload({
        sessionId: 'sess-x',
        buildSha: 'sha',
        occurredAt: 'now',
        verdict: { crashed: true, reason: 'reason' },
        userAgent: 'UA',
        viewport: { w: 10, h: 10, dpr: 1 },
        performanceMode: 'high',
        errorSummary: {
          message: 'crash near sandeater@gmail.com',
          firstFrame: 'at line ghp_abcdefghijklmnopqrst',
        },
        telemetryText:
          'load route from leaked@example.com at 51.5074, -0.1278 token=ghp_abcdefghijklmnopqrstuv',
        intervalsIcuAthleteId: '12345',
      });
      const s = JSON.stringify(out);
      expect(s).not.toContain('leaked@example.com');
      expect(s).not.toContain('sandeater');
      expect(s).not.toContain('ghp_abcdefghijklmnopqrst');
      expect(s).not.toMatch(/51\.5074, -0\.1278/);
      // The whitelisted athlete id survives.
      expect(out.intervalsIcuAthleteId).toBe('12345');
    });

    it('drops a non-numeric intervalsIcuAthleteId', () => {
      const out = redactCrashPayload({
        intervalsIcuAthleteId: 'name-leaked',
      });
      expect(out.intervalsIcuAthleteId).toBeNull();
    });

    it('truncates oversized telemetry', () => {
      const big = 'y'.repeat(20 * 1024);
      const out = redactCrashPayload({ telemetryText: big });
      expect(out.telemetryText.length).toBeLessThanOrEqual(16 * 1024 + 100);
      expect(out.telemetryText).toContain('truncated');
    });

    it('normalises an unknown performance tier to medium', () => {
      const out = redactCrashPayload({
        performanceMode: 'ultra' as unknown as 'high',
      });
      expect(out.performanceMode).toBe('medium');
    });

    it('serialises under 32 KB for a worst-case recovered log (AC4)', () => {
      const out = redactCrashPayload({
        sessionId: 'sess-1',
        buildSha: 'abc',
        occurredAt: '2026-10-12T20:00:00Z',
        verdict: { crashed: true, reason: 'the renderer process crashed' },
        userAgent: 'Mozilla/5.0 '.repeat(50),
        viewport: { w: 1920, h: 1080, dpr: 2 },
        performanceMode: 'extra-high',
        errorSummary: { message: 'x'.repeat(5000), firstFrame: 'y'.repeat(5000) },
        telemetryText: 'z'.repeat(100 * 1024),
      });
      expect(JSON.stringify(out).length).toBeLessThanOrEqual(32 * 1024);
    });
  });
});
