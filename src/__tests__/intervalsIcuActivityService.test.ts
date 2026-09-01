import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { IntervalsIcuActivityService } from '../services/intervalsIcuActivityService';
import { PROXY_BASE } from '../services/authService';
import type { WorkoutSession } from '../types/index';

/**
 * Upload tests for issue #221, R3.
 *
 * Nothing here reaches intervals.icu or the real proxy (AC3.8) — `fetch` is
 * stubbed and every assertion is made against the request the service built.
 */

function makeSession(overrides: Partial<WorkoutSession> = {}): WorkoutSession {
  return {
    id: '1773475200000',
    routeId: 'r1',
    routeName: 'Willowbrook River',
    startTime: new Date('2026-03-14T08:00:00Z'),
    endTime: new Date('2026-03-14T08:21:14Z'),
    duration: 1274,
    distance: 5000,
    averagePace: 127,
    calories: 240,
    splits: [],
    isActive: false,
    samples: [{ t: 0, distance: 0 }],
    ...overrides,
  };
}

const FILE = new Uint8Array([0x0e, 0x10, 0x20, 0x00]);

function makeAuth(overrides: Partial<{ accessToken: string | null; refreshes: boolean }> = {}) {
  const { accessToken = 'token-1', refreshes = true } = overrides;
  let token = accessToken;
  return {
    getAccessToken: () => token,
    refreshAccessToken: vi.fn(async () => {
      if (!refreshes) return false;
      token = 'token-2';
      return true;
    }),
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('IntervalsIcuActivityService (issue #221, R3)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('returns the created activity id and a link to it (AC3.1)', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: 'i99887766' }));
    const service = new IntervalsIcuActivityService();

    const result = await service.uploadActivity(makeSession(), FILE, makeAuth());

    expect(result).toEqual({
      status: 'uploaded',
      activityId: 'i99887766',
      activityUrl: 'https://intervals.icu/activities/i99887766',
    });
  });

  it('posts multipart to athlete 0 with the session external id (AC3.2)', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: 'i1' }));
    const service = new IntervalsIcuActivityService();

    await service.uploadActivity(makeSession(), FILE, makeAuth());

    const [url, init] = fetchMock.mock.calls[0];
    const requested = new URL(url as string);
    expect(requested.pathname).toBe(new URL(`${PROXY_BASE}/api/v1/athlete/0/activities`).pathname);
    expect(requested.searchParams.get('external_id')).toBe('virtualrow-1773475200000');
    expect(requested.searchParams.get('name')).toBe('Willowbrook River');
    expect(requested.searchParams.get('description')).toContain('VirtualRow');

    expect((init as RequestInit).method).toBe('POST');
    expect((init as RequestInit).headers).toMatchObject({ Authorization: 'Bearer token-1' });

    const body = (init as RequestInit).body as FormData;
    expect(body).toBeInstanceOf(FormData);
    const file = body.get('file') as File;
    expect(file.name).toBe('willowbrook-river-2026-03-14.fit');
  });

  it('never sets Content-Type itself, so the multipart boundary survives', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: 'i1' }));
    await new IntervalsIcuActivityService().uploadActivity(makeSession(), FILE, makeAuth());

    const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>;
    expect(Object.keys(headers).map((k) => k.toLowerCase())).not.toContain('content-type');
  });

  it('does not upload the same session twice (AC3.3)', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: 'i42' }));
    const service = new IntervalsIcuActivityService();
    const session = makeSession();

    const first = await service.uploadActivity(session, FILE, makeAuth());
    const second = await service.uploadActivity(session, FILE, makeAuth());

    expect(first.status).toBe('uploaded');
    expect(second).toEqual({
      status: 'already-uploaded',
      activityId: 'i42',
      activityUrl: 'https://intervals.icu/activities/i42',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('reports an upstream duplicate as already saved (AC3.3)', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ error: 'Duplicate activity', id: 'i7' }, 422),
    );

    const result = await new IntervalsIcuActivityService()
      .uploadActivity(makeSession(), FILE, makeAuth());

    expect(result.status).toBe('already-uploaded');
  });

  it('refreshes once on a 401 and retries with the new token (AC3.4)', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ error: 'Unauthorized' }, 401))
      .mockResolvedValueOnce(jsonResponse({ id: 'i55' }));
    const auth = makeAuth();

    const result = await new IntervalsIcuActivityService()
      .uploadActivity(makeSession(), FILE, auth);

    expect(auth.refreshAccessToken).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][1].headers).toMatchObject({ Authorization: 'Bearer token-2' });
    expect(result.status).toBe('uploaded');
  });

  it('surfaces an expired session after a second 401 (AC3.4)', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: 'Unauthorized' }, 401));
    const auth = makeAuth();

    const result = await new IntervalsIcuActivityService()
      .uploadActivity(makeSession(), FILE, auth);

    expect(auth.refreshAccessToken).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result).toEqual({
      status: 'auth-expired',
      message: 'Your intervals.icu session expired — sign in again.',
    });
  });

  it('does not retry when the refresh itself fails (AC3.4)', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: 'Unauthorized' }, 401));
    const auth = makeAuth({ refreshes: false });

    const result = await new IntervalsIcuActivityService()
      .uploadActivity(makeSession(), FILE, auth);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('auth-expired');
  });

  it('surfaces the status and the API message for a 4xx (AC3.5)', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: 'Unsupported file type' }, 400));

    const result = await new IntervalsIcuActivityService()
      .uploadActivity(makeSession(), FILE, makeAuth());

    expect(result.status).toBe('failed');
    expect(result).toHaveProperty('message', expect.stringContaining('400'));
    expect(result).toHaveProperty('message', expect.stringContaining('Unsupported file type'));
  });

  it('surfaces the status and the body for a 5xx with no JSON (AC3.5)', async () => {
    fetchMock.mockResolvedValue(new Response('Bad Gateway', { status: 502 }));

    const result = await new IntervalsIcuActivityService()
      .uploadActivity(makeSession(), FILE, makeAuth());

    expect(result.status).toBe('failed');
    expect(result).toHaveProperty('message', expect.stringContaining('502'));
    expect(result).toHaveProperty('message', expect.stringContaining('Bad Gateway'));
    expect(result).not.toHaveProperty('message', 'Upload failed');
  });

  it('leaves the session retryable after a network failure (AC3.6)', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const service = new IntervalsIcuActivityService();
    const session = makeSession();

    const failed = await service.uploadActivity(session, FILE, makeAuth());
    expect(failed.status).toBe('failed');
    expect(failed).toHaveProperty('message', expect.stringContaining('Failed to fetch'));

    // Nothing was recorded as uploaded, so a retry goes out again.
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 'i77' }));
    const retried = await service.uploadActivity(session, FILE, makeAuth());
    expect(retried.status).toBe('uploaded');
  });

  it('refuses to upload without an access token', async () => {
    const result = await new IntervalsIcuActivityService()
      .uploadActivity(makeSession(), FILE, makeAuth({ accessToken: null }));

    expect(result.status).toBe('auth-expired');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses to upload a guest session (AC5.1)', async () => {
    const result = await new IntervalsIcuActivityService()
      .uploadActivity(makeSession({ isGuest: true }), FILE, makeAuth());

    expect(result.status).toBe('failed');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reads an activity id returned as an array', async () => {
    fetchMock.mockResolvedValue(jsonResponse([{ id: 'i123' }]));

    const result = await new IntervalsIcuActivityService()
      .uploadActivity(makeSession(), FILE, makeAuth());

    expect(result).toMatchObject({ status: 'uploaded', activityId: 'i123' });
  });

  it('still reports success when the response carries no id', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}));

    const result = await new IntervalsIcuActivityService()
      .uploadActivity(makeSession(), FILE, makeAuth());

    expect(result.status).toBe('uploaded');
    expect(result).toMatchObject({ activityId: '' });
  });
});
