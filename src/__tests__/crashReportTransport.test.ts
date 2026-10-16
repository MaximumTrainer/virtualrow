import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  CRASH_DISPATCH_EVENT_TYPE,
  CrashTransportError,
  makeRepositoryDispatchTransport,
} from '../services/crashReportTransport';
import type { CrashPayload } from '../types/crashPayload';

const payload: CrashPayload = {
  schemaVersion: 1,
  kind: 'crash',
  sessionId: 'sess-1',
  buildSha: 'cafef00d',
  occurredAt: '2026-10-13T20:00:00Z',
  verdict: { crashed: true, reason: 'kaboom' },
  userAgent: 'ua',
  viewport: { w: 1024, h: 768, dpr: 2 },
  performanceMode: 'high',
  errorSummary: { message: 'boom', firstFrame: null },
  telemetryText: '',
  intervalsIcuAthleteId: null,
  authFailure: null,
};

describe('makeRepositoryDispatchTransport (#473 Phase 3, FR5)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('POSTs the payload wrapped in a repository_dispatch envelope', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 204 }));

    const transport = makeRepositoryDispatchTransport(
      'https://api.github.com/repos/MaximumTrainer/virtualrow/dispatches',
      'ghp_fake-token',
    );
    await transport(payload);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0]!;
    const body = JSON.parse(String(init?.body));
    expect(body.event_type).toBe(CRASH_DISPATCH_EVENT_TYPE);
    // Nested under one key so client_payload stays within GitHub's 10-key cap.
    expect(body.client_payload).toEqual({ payload });
    expect(Object.keys(body.client_payload).length).toBeLessThanOrEqual(10);
    const headers = init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer ghp_fake-token');
    expect(headers['Content-Type']).toBe('application/json');
  });

  it('keeps client_payload within GitHub\'s 10-top-level-key cap', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 204 }));

    const transport = makeRepositoryDispatchTransport('https://x.test', 'tkn');
    await transport(payload);

    const [, init] = fetchMock.mock.calls[0]!;
    const body = JSON.parse(String(init?.body));
    // The real GitHub API returns 422 if client_payload has more than 10
    // top-level keys. A regression that un-nests the payload would reintroduce
    // the production 422; this test is the gate.
    expect(Object.keys(body.client_payload).length).toBeLessThanOrEqual(10);
  });

  it('throws CrashTransportError on non-2xx so the reporter can retry', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 503 }));
    const transport = makeRepositoryDispatchTransport('https://x.test', 'tkn');
    await expect(transport(payload)).rejects.toBeInstanceOf(CrashTransportError);
  });

  it('throws CrashTransportError on network failure without the token in the message (NFR5)', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Failed to fetch'));
    const transport = makeRepositoryDispatchTransport('https://x.test', 'super-secret-token');
    const err = await transport(payload).catch((e) => e);
    expect(err).toBeInstanceOf(CrashTransportError);
    expect(String(err.message)).not.toContain('super-secret-token');
  });

  it('fails cleanly when endpoint or token is missing', async () => {
    const transport = makeRepositoryDispatchTransport('', 'tkn');
    await expect(transport(payload)).rejects.toBeInstanceOf(CrashTransportError);
  });
});
