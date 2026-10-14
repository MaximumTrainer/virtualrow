#!/usr/bin/env node
/**
 * Server-side crash-report triage for issue #473 Phase 4 (AC14).
 *
 * Entry point for the `crash-triage.yml` workflow, which fires on
 * `repository_dispatch(event_type=crash_report)`. The browser side
 * (`crashReporterService.ts`) builds the payload and signature; this script
 * decides what to do with it on the repo:
 *
 *  - OPEN issue with the same signature → add a one-line "+1 occurrence"
 *    comment, keeping the issue count flat.
 *  - CLOSED issue with the same signature, closed > 7 days ago → reopen it
 *    with a comment ("re-opened: new occurrence after 7-day quiet period").
 *  - CLOSED issue closed ≤ 7 days ago → no-op. A recently closed match was
 *    deliberately resolved; the next load either dedupes or waits out the
 *    quiet period.
 *  - No match → open a new issue, label it `crash-report`, embed the
 *    signature as an HTML comment marker so later dispatches find it.
 *
 * Server-side rate limit (D6, AC14's server half):
 *  - MAX_NEW_ISSUES_PER_24H across all signatures caps the volume of
 *    new issues created on a brown-out.
 *  - MAX_COMMENTS_PER_ISSUE_PER_24H caps the +1 comments on a single
 *    long-running crash, so a repeating bug does not spam one issue's
 *    thread while still showing it is active.
 *
 * The browser-side dedupe (FR7) already drops duplicates per profile; this
 * is the second line of defence against a flood from many profiles.
 */

export const CRASH_LABEL = 'crash-report';
export const SIGNATURE_MARKER_PREFIX = '<!-- crash-signature:';
export const SIGNATURE_MARKER_SUFFIX = '-->';
export const RECENT_CLOSE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
export const RATE_WINDOW_MS = 24 * 60 * 60 * 1000;
export const MAX_NEW_ISSUES_PER_24H = 20;
export const MAX_COMMENTS_PER_ISSUE_PER_24H = 10;

/** @typedef {{message?: string|null, firstFrame?: string|null} | null} ErrorSummary */
/** @typedef {{errorSummary: ErrorSummary, userAgent?: string}} SignatureInputs */

/**
 * Rebuild the browser-side signature on the server so the triage can
 * recognise a match regardless of what the issue body happens to contain.
 * Kept byte-identical to `buildSignature` in `crashReporterService.ts`.
 */
export function buildSignature(payload) {
  const message = payload?.errorSummary?.message ?? 'nocrash';
  const frame = payload?.errorSummary?.firstFrame ?? 'noframe';
  const ua = (payload?.userAgent || 'ua').split(' ')[0];
  return `${message}|${frame}|${ua}`;
}

/**
 * The signature is written back as an HTML comment so it survives GitHub's
 * markdown render as invisible metadata. A short hex hash is used in the
 * marker — a stack frame can contain any character including the comment
 * closer, so the raw signature can't go there unescaped.
 */
export function signatureMarker(signature) {
  // A short, stable hash is enough for a dedup key; collisions across
  // distinct bugs are extremely unlikely at this fan-out, and false
  // positives collapse two issues into one, which is harmless.
  let h = 0;
  for (let i = 0; i < signature.length; i += 1) {
    h = (h * 31 + signature.charCodeAt(i)) | 0;
  }
  const unsigned = h >>> 0;
  return `${SIGNATURE_MARKER_PREFIX} ${unsigned.toString(16).padStart(8, '0')} ${SIGNATURE_MARKER_SUFFIX}`;
}

function bodyHasMarker(body, marker) {
  if (typeof body !== 'string' || body.length === 0) return false;
  return body.includes(marker);
}

function parseIsoDateMs(iso) {
  const t = Date.parse(iso ?? '');
  return Number.isFinite(t) ? t : null;
}

/**
 * Find a matching issue by scanning the first N labelled issues (open and
 * closed) for the signature marker. The label narrows the search so this
 * stays cheap even when the repo has thousands of other issues.
 */
export async function findMatchingIssue({ octokit, owner, repo, marker, pageSize = 100 }) {
  // State 'all' lets us pick up a recently closed match in one pass. The
  // label keeps the list cheap.
  const { data } = await octokit.rest.issues.listForRepo({
    owner,
    repo,
    labels: CRASH_LABEL,
    state: 'all',
    per_page: pageSize,
    sort: 'updated',
    direction: 'desc',
  });
  for (const issue of data) {
    if (issue.pull_request) continue; // the search includes PRs, which share the id space
    if (bodyHasMarker(issue.body, marker)) return issue;
  }
  return null;
}

/**
 * Count how many issues this workflow created in the last 24h. The server-
 * side rate limit uses this to drop new-issue creation during a brown-out
 * (D6). Comments on existing issues are counted per-issue separately.
 */
export async function countRecentNewIssues({ octokit, owner, repo, nowMs, pageSize = 100 }) {
  const { data } = await octokit.rest.issues.listForRepo({
    owner,
    repo,
    labels: CRASH_LABEL,
    state: 'all',
    per_page: pageSize,
    sort: 'created',
    direction: 'desc',
  });
  let count = 0;
  for (const issue of data) {
    if (issue.pull_request) continue;
    const createdMs = parseIsoDateMs(issue.created_at);
    if (createdMs !== null && nowMs - createdMs < RATE_WINDOW_MS) count += 1;
  }
  return count;
}

/**
 * Count +1 comments posted on one issue in the last 24h. Caps a repeating
 * bug's comment thread so a single issue doesn't become a 10 000-line log
 * (D6, AC14).
 */
export async function countRecentCommentsOnIssue({ octokit, owner, repo, issueNumber, nowMs, pageSize = 100 }) {
  const { data } = await octokit.rest.issues.listComments({
    owner,
    repo,
    issue_number: issueNumber,
    per_page: pageSize,
    sort: 'created',
    direction: 'desc',
  });
  let count = 0;
  for (const comment of data) {
    const createdMs = parseIsoDateMs(comment.created_at);
    if (createdMs !== null && nowMs - createdMs < RATE_WINDOW_MS) count += 1;
  }
  return count;
}

/** The outcome shape, used both by the workflow log and by the tests. */
/** @typedef {{ action: 'commented'|'reopened'|'created'|'skipped-recent-close'|'skipped-new-issue-cap'|'skipped-comment-cap'|'skipped-invalid-payload'|'opt-out', issueNumber?: number, reason?: string }} TriageOutcome */

function buildIssueTitle(payload) {
  const raw = payload?.errorSummary?.message?.trim() || 'VirtualRow crash (no error message)';
  const trimmed = raw.length > 140 ? `${raw.slice(0, 137)}…` : raw;
  return `[crash] ${trimmed}`;
}

function buildIssueBody({ payload, marker, signature }) {
  const summary = payload?.errorSummary ?? {};
  const viewport = payload?.viewport ?? {};
  const verdict = payload?.verdict ?? {};
  const safeTelemetry =
    typeof payload?.telemetryText === 'string'
      ? payload.telemetryText
      : '(no telemetry recovered)';
  // The telemetry block is already redacted by `redactCrashPayload` before
  // the browser POSTs; this script never un-redacts it.
  return [
    marker,
    '',
    '**Automated crash report.** VirtualRow telemetry picked up a crash on a',
    'rower\'s next page load, or inside an error boundary during a session.',
    '',
    `- **Signature:** \`${signature}\``,
    `- **Build:** \`${payload?.buildSha ?? '(unknown)'}\``,
    `- **Session id:** \`${payload?.sessionId ?? '(unknown)'}\``,
    `- **Occurred at (reporter clock):** ${payload?.occurredAt ?? '(unknown)'}`,
    `- **Verdict:** ${verdict.crashed ? 'crashed' : 'no-crash'} — ${verdict.reason ?? '(no reason)'}`,
    `- **Performance mode:** \`${payload?.performanceMode ?? '(unknown)'}\``,
    `- **User agent:** \`${payload?.userAgent ?? '(unknown)'}\``,
    `- **Viewport:** ${viewport.w ?? '?'}×${viewport.h ?? '?'} @ ${viewport.dpr ?? '?'}dpr`,
    '',
    '### Error summary',
    '',
    '```',
    `message: ${summary.message ?? '(none)'}`,
    `firstFrame: ${summary.firstFrame ?? '(none)'}`,
    '```',
    '',
    '### Recovered telemetry (redacted)',
    '',
    '```',
    safeTelemetry,
    '```',
    '',
    '<sub>Posted by the `crash-triage` workflow on behalf of ',
    '[`crashReporterService.ts`](../blob/main/src/services/crashReporterService.ts).</sub>',
  ].join('\n');
}

function buildCommentBody({ payload, signature }) {
  return [
    `+1 occurrence (signature \`${signature}\`).`,
    '',
    `- **Build:** \`${payload?.buildSha ?? '(unknown)'}\``,
    `- **Session id:** \`${payload?.sessionId ?? '(unknown)'}\``,
    `- **Occurred at (reporter clock):** ${payload?.occurredAt ?? '(unknown)'}`,
    `- **Performance mode:** \`${payload?.performanceMode ?? '(unknown)'}\``,
    `- **User agent:** \`${payload?.userAgent ?? '(unknown)'}\``,
    '',
    '<sub>Automated by the `crash-triage` workflow.</sub>',
  ].join('\n');
}

function buildReopenBody({ payload, signature, closedAtIso }) {
  return [
    `Re-opened: a new occurrence of signature \`${signature}\` arrived more`,
    `than 7 days after this issue was last closed (closed_at: ${closedAtIso ?? '(unknown)'}).`,
    '',
    `- **Build:** \`${payload?.buildSha ?? '(unknown)'}\``,
    `- **Session id:** \`${payload?.sessionId ?? '(unknown)'}\``,
    `- **Occurred at (reporter clock):** ${payload?.occurredAt ?? '(unknown)'}`,
    '',
    '<sub>Automated by the `crash-triage` workflow.</sub>',
  ].join('\n');
}

/**
 * Pure triage decision. Returns an outcome describing what was done; the
 * side effects are performed on the provided `octokit`. Separated from the
 * CLI entrypoint so the unit tests can drive it with a fake octokit.
 */
export async function triageCrashReport({ payload, octokit, owner, repo, nowMs }) {
  // Guard: a browser can POST any JSON through `repository_dispatch`; we
  // only accept payloads that look like a CrashPayload. Anything else is
  // noise and gets dropped — no new issue, no reopen.
  if (!payload || typeof payload !== 'object') {
    return { action: 'skipped-invalid-payload', reason: 'payload-not-object' };
  }
  if (!payload.verdict || payload.verdict.crashed !== true) {
    return { action: 'skipped-invalid-payload', reason: 'verdict-not-crashed' };
  }

  const signature = buildSignature(payload);
  const marker = signatureMarker(signature);

  const existing = await findMatchingIssue({ octokit, owner, repo, marker });

  if (existing && existing.state === 'open') {
    const commentCount = await countRecentCommentsOnIssue({
      octokit,
      owner,
      repo,
      issueNumber: existing.number,
      nowMs,
    });
    if (commentCount >= MAX_COMMENTS_PER_ISSUE_PER_24H) {
      return {
        action: 'skipped-comment-cap',
        issueNumber: existing.number,
        reason: `issue already has ${commentCount} crash-report comments in the last 24h`,
      };
    }
    await octokit.rest.issues.createComment({
      owner,
      repo,
      issue_number: existing.number,
      body: buildCommentBody({ payload, signature }),
    });
    return { action: 'commented', issueNumber: existing.number };
  }

  if (existing && existing.state === 'closed') {
    const closedMs = parseIsoDateMs(existing.closed_at);
    if (closedMs !== null && nowMs - closedMs < RECENT_CLOSE_WINDOW_MS) {
      return {
        action: 'skipped-recent-close',
        issueNumber: existing.number,
        reason: `closed ${Math.round((nowMs - closedMs) / (24 * 60 * 60 * 1000))}d ago (<7d)`,
      };
    }
    await octokit.rest.issues.update({
      owner,
      repo,
      issue_number: existing.number,
      state: 'open',
    });
    await octokit.rest.issues.createComment({
      owner,
      repo,
      issue_number: existing.number,
      body: buildReopenBody({ payload, signature, closedAtIso: existing.closed_at }),
    });
    return { action: 'reopened', issueNumber: existing.number };
  }

  // No matching issue — create one, subject to the 24h new-issue cap.
  const recentCount = await countRecentNewIssues({ octokit, owner, repo, nowMs });
  if (recentCount >= MAX_NEW_ISSUES_PER_24H) {
    return {
      action: 'skipped-new-issue-cap',
      reason: `${recentCount} crash-report issues already created in the last 24h`,
    };
  }

  const created = await octokit.rest.issues.create({
    owner,
    repo,
    title: buildIssueTitle(payload),
    body: buildIssueBody({ payload, marker, signature }),
    labels: [CRASH_LABEL],
  });
  return { action: 'created', issueNumber: created.data?.number };
}

// The CLI entrypoint lives in `crash-triage-cli.mjs`. Keeping it out of
// this module lets Vitest import `triageCrashReport` without resolving
// `@octokit/rest` or running any workflow-only side effects.
