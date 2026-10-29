import { describe, it, expect } from 'vitest';
import {
  CRASH_LABEL,
  MAX_COMMENTS_PER_ISSUE_PER_24H,
  MAX_NEW_ISSUES_PER_24H,
  RECENT_CLOSE_WINDOW_MS,
  buildSignature,
  signatureMarker,
  triageCrashReport,
} from '../crash-triage.mjs';

/**
 * Workflow-level unit tests for the Phase 4 server-side triage (issue #473,
 * AC14). The real workflow invokes `triageCrashReport` through an authenticated
 * octokit; here every test wires a plain-object fake so the dedup / reopen /
 * rate-limit decisions can be asserted without a GitHub round trip.
 */

const basePayload = (over = {}) => ({
  schemaVersion: 1,
  sessionId: 'sess-triage-1',
  buildSha: 'deadbeef',
  occurredAt: '2026-10-13T20:00:00Z',
  verdict: { crashed: true, reason: 'the renderer process crashed' },
  userAgent: 'Mozilla/5.0 (test)',
  viewport: { w: 1024, h: 768, dpr: 2 },
  performanceMode: 'high',
  errorSummary: { message: 'TypeError: boom', firstFrame: 'at useFrame (Rower3D.tsx:1)' },
  telemetryText: 'run-start route=? [REDACTED]',
  intervalsIcuAthleteId: null,
  ...over,
});

/**
 * Make a fake octokit with the four REST methods the triage uses. Each
 * method records every call, so a test can assert both what came back and
 * what the triage then did.
 */
const makeOctokit = (overrides = {}) => {
  const calls = [];
  const api = {
    rest: {
      issues: {
        listForRepo: async (args) => {
          calls.push({ method: 'listForRepo', args });
          const impl = overrides.listForRepo ?? (async () => ({ data: [] }));
          return impl(args);
        },
        listComments: async (args) => {
          calls.push({ method: 'listComments', args });
          const impl = overrides.listComments ?? (async () => ({ data: [] }));
          return impl(args);
        },
        createComment: async (args) => {
          calls.push({ method: 'createComment', args });
          return { data: { id: 999 } };
        },
        update: async (args) => {
          calls.push({ method: 'update', args });
          return { data: { number: args.issue_number, state: args.state } };
        },
        create: async (args) => {
          calls.push({ method: 'create', args });
          return { data: { number: 1234 } };
        },
      },
    },
  };
  return { api, calls };
};

describe('crash-triage (#473 Phase 4, AC14)', () => {
  it('reuses the browser-side signature verbatim', () => {
    expect(
      buildSignature({
        errorSummary: { message: 'cannot read x', firstFrame: 'at useFrame' },
        userAgent: 'Mozilla/5.0 (X11; Linux)',
      }),
    ).toBe('cannot read x|at useFrame|Mozilla/5.0');
  });

  it('builds a stable, HTML-safe signature marker', () => {
    const marker = signatureMarker('boom|frame|UA');
    expect(marker.startsWith('<!-- crash-signature:')).toBe(true);
    expect(marker.endsWith('-->')).toBe(true);
    // Deterministic — two calls on the same input give the same hash.
    expect(signatureMarker('boom|frame|UA')).toBe(marker);
    // Different signatures produce different markers.
    expect(signatureMarker('other|frame|UA')).not.toBe(marker);
  });

  it('drops a payload whose verdict is not a crash', async () => {
    const { api, calls } = makeOctokit();
    const outcome = await triageCrashReport({
      payload: basePayload({ verdict: { crashed: false, reason: 'ok' } }),
      octokit: api,
      owner: 'maximum-trainer',
      repo: 'virtualrow',
      nowMs: Date.now(),
    });
    expect(outcome.action).toBe('skipped-invalid-payload');
    expect(calls).toHaveLength(0);
  });

  it('drops a non-object payload', async () => {
    const { api } = makeOctokit();
    const outcome = await triageCrashReport({
      payload: null,
      octokit: api,
      owner: 'o',
      repo: 'r',
      nowMs: Date.now(),
    });
    expect(outcome.action).toBe('skipped-invalid-payload');
  });

  it('comments on an open issue whose body carries the signature marker', async () => {
    const payload = basePayload();
    const marker = signatureMarker(buildSignature(payload));
    const { api, calls } = makeOctokit({
      listForRepo: async () => ({
        data: [
          {
            number: 42,
            state: 'open',
            body: `preface\n${marker}\ntrail`,
            created_at: '2026-10-10T00:00:00Z',
          },
        ],
      }),
    });

    const outcome = await triageCrashReport({
      payload,
      octokit: api,
      owner: 'o',
      repo: 'r',
      nowMs: Date.parse('2026-10-13T20:00:00Z'),
    });

    expect(outcome).toEqual({ action: 'commented', issueNumber: 42 });
    const commentCall = calls.find((c) => c.method === 'createComment');
    expect(commentCall?.args.issue_number).toBe(42);
    expect(commentCall?.args.body).toMatch(/\+1 occurrence/);
    // The triage must not have created a new issue.
    expect(calls.some((c) => c.method === 'create')).toBe(false);
  });

  it('reopens a matching issue closed more than 7 days ago', async () => {
    const payload = basePayload();
    const marker = signatureMarker(buildSignature(payload));
    const nowMs = Date.parse('2026-10-13T20:00:00Z');
    const closedAtIso = new Date(nowMs - 8 * 24 * 60 * 60 * 1000).toISOString();
    const { api, calls } = makeOctokit({
      listForRepo: async () => ({
        data: [
          {
            number: 99,
            state: 'closed',
            body: marker,
            created_at: '2026-09-10T00:00:00Z',
            closed_at: closedAtIso,
          },
        ],
      }),
    });

    const outcome = await triageCrashReport({
      payload,
      octokit: api,
      owner: 'o',
      repo: 'r',
      nowMs,
    });

    expect(outcome).toEqual({ action: 'reopened', issueNumber: 99 });
    const updateCall = calls.find((c) => c.method === 'update');
    expect(updateCall?.args).toMatchObject({ issue_number: 99, state: 'open' });
    expect(calls.some((c) => c.method === 'createComment')).toBe(true);
    expect(calls.some((c) => c.method === 'create')).toBe(false);
  });

  it('does nothing when a matching issue was closed within the last 7 days', async () => {
    const payload = basePayload();
    const marker = signatureMarker(buildSignature(payload));
    const nowMs = Date.parse('2026-10-13T20:00:00Z');
    const closedAtIso = new Date(nowMs - 2 * 24 * 60 * 60 * 1000).toISOString();
    const { api, calls } = makeOctokit({
      listForRepo: async () => ({
        data: [
          {
            number: 55,
            state: 'closed',
            body: marker,
            created_at: '2026-09-10T00:00:00Z',
            closed_at: closedAtIso,
          },
        ],
      }),
    });

    const outcome = await triageCrashReport({
      payload,
      octokit: api,
      owner: 'o',
      repo: 'r',
      nowMs,
    });

    expect(outcome.action).toBe('skipped-recent-close');
    expect(outcome.issueNumber).toBe(55);
    expect(calls.some((c) => c.method === 'update')).toBe(false);
    expect(calls.some((c) => c.method === 'createComment')).toBe(false);
    expect(calls.some((c) => c.method === 'create')).toBe(false);
  });

  it('creates a labelled issue with the signature marker when nothing matches', async () => {
    const payload = basePayload();
    const marker = signatureMarker(buildSignature(payload));
    const { api, calls } = makeOctokit({
      listForRepo: async ({ sort }) => {
        if (sort === 'created') return { data: [] };
        return { data: [] };
      },
    });

    const outcome = await triageCrashReport({
      payload,
      octokit: api,
      owner: 'o',
      repo: 'r',
      nowMs: Date.parse('2026-10-13T20:00:00Z'),
    });

    expect(outcome).toEqual({ action: 'created', issueNumber: 1234 });
    const createCall = calls.find((c) => c.method === 'create');
    expect(createCall?.args.labels).toEqual([CRASH_LABEL]);
    expect(createCall?.args.body).toContain(marker);
    expect(createCall?.args.title.startsWith('[crash]')).toBe(true);
  });

  it('respects the 24h new-issue cap (server-side D6)', async () => {
    const payload = basePayload();
    const recentIssues = Array.from({ length: MAX_NEW_ISSUES_PER_24H }).map((_, i) => ({
      number: 100 + i,
      state: 'open',
      body: '(unrelated other issue)',
      created_at: new Date(Date.parse('2026-10-13T20:00:00Z') - 60_000).toISOString(),
    }));
    const { api, calls } = makeOctokit({
      listForRepo: async () => ({ data: recentIssues }),
    });

    const outcome = await triageCrashReport({
      payload,
      octokit: api,
      owner: 'o',
      repo: 'r',
      nowMs: Date.parse('2026-10-13T20:00:00Z'),
    });

    expect(outcome.action).toBe('skipped-new-issue-cap');
    expect(calls.some((c) => c.method === 'create')).toBe(false);
  });

  it('respects the 24h per-issue comment cap on an open match', async () => {
    const payload = basePayload();
    const marker = signatureMarker(buildSignature(payload));
    const nowMs = Date.parse('2026-10-13T20:00:00Z');
    const comments = Array.from({ length: MAX_COMMENTS_PER_ISSUE_PER_24H }).map((_, i) => ({
      id: i,
      created_at: new Date(nowMs - 60_000).toISOString(),
    }));
    const { api, calls } = makeOctokit({
      listForRepo: async () => ({
        data: [
          {
            number: 7,
            state: 'open',
            body: marker,
            created_at: '2026-10-10T00:00:00Z',
          },
        ],
      }),
      listComments: async () => ({ data: comments }),
    });

    const outcome = await triageCrashReport({
      payload,
      octokit: api,
      owner: 'o',
      repo: 'r',
      nowMs,
    });

    expect(outcome.action).toBe('skipped-comment-cap');
    expect(outcome.issueNumber).toBe(7);
    expect(calls.some((c) => c.method === 'createComment')).toBe(false);
  });

  it('ignores pull requests that share the issue id space', async () => {
    const payload = basePayload();
    const marker = signatureMarker(buildSignature(payload));
    const { api, calls } = makeOctokit({
      listForRepo: async () => ({
        data: [
          {
            number: 777,
            state: 'open',
            body: marker,
            pull_request: { url: 'https://github.com/example/example/pull/777' },
            created_at: '2026-10-10T00:00:00Z',
          },
        ],
      }),
    });

    const outcome = await triageCrashReport({
      payload,
      octokit: api,
      owner: 'o',
      repo: 'r',
      nowMs: Date.parse('2026-10-13T20:00:00Z'),
    });

    expect(outcome.action).toBe('created');
    expect(calls.some((c) => c.method === 'createComment')).toBe(false);
  });

  it('uses RECENT_CLOSE_WINDOW_MS = 7 days (locks the AC14 boundary)', () => {
    expect(RECENT_CLOSE_WINDOW_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });
});
