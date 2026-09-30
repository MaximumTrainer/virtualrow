import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Static gate on the Neon healthcheck script (#441, NFR-S4 / AC13).
 *
 * Same shape as `fitUploadContractCheck.test.ts` (#446): the script itself
 * runs against a live database and cannot execute in vitest, so the tests
 * assert its shape — nothing writes the connection URL to the log, the URL
 * is read from `process.env` (not `argv`), the assertions on TLS version
 * and the URL parameters exist.
 */
const HEALTHCHECK = readFileSync(
  resolve(__dirname, '../../.github/scripts/neon-healthcheck.mjs'),
  'utf8',
);
const WORKFLOW = readFileSync(
  resolve(__dirname, '../../.github/workflows/neon-healthcheck.yml'),
  'utf8',
);

describe('neon-healthcheck.mjs (#441, NFR-S4 / AC13)', () => {
  it('reads NEON_CI_READONLY_URL from process.env, not argv', () => {
    expect(HEALTHCHECK).toMatch(/process\.env\.NEON_CI_READONLY_URL/);
    // Never uses argv[2] or similar to accept the URL — that would put it in
    // process listings + `set -x` output (NFR-S4).
    expect(HEALTHCHECK).not.toMatch(/process\.argv\[[0-9]+\]/);
  });

  it('never console.logs the URL value or connection host (NFR-S4)', () => {
    // Logging the secret NAME as part of a diagnostic string is fine
    // ("fail: NEON_CI_READONLY_URL is not set"); logging the VALUE is not.
    // The value only reaches the script via process.env; a template-literal
    // interpolation of that variable inside a console call is what we reject.
    expect(HEALTHCHECK).not.toMatch(
      /console\.[a-z]+\([^)]*\$\{process\.env\.NEON_CI_READONLY_URL/,
    );
    expect(HEALTHCHECK).not.toMatch(/console\.[a-z]+\([^)]*\$\{url\}/);
    // `connectionString` only appears on the pg.Client constructor, never in
    // a console call.
    expect(HEALTHCHECK).not.toMatch(/console\.[a-z]+\([^)]*connectionString/);
  });

  it('scrubs any leaked URL or Neon host from error output', () => {
    // Both scrubber regexes and both redaction strings are present.
    expect(HEALTHCHECK).toContain('postgres(?:ql)?:');
    expect(HEALTHCHECK).toContain('neon\\.tech');
    expect(HEALTHCHECK).toContain('<url redacted>');
    expect(HEALTHCHECK).toContain('<host redacted>');
  });

  it('asserts TLS version >= 1.2 on the live connection (AC11)', () => {
    expect(HEALTHCHECK).toMatch(/pg_stat_ssl/);
    expect(HEALTHCHECK).toMatch(/TLSv/);
    // The version compare uses numeric parsing on major.minor.
    expect(HEALTHCHECK).toMatch(/TLS version below 1\.2/);
  });

  it('opens exactly one client and closes it in a finally', () => {
    expect(HEALTHCHECK).toMatch(/new pg\.Client/);
    expect(HEALTHCHECK).toMatch(/} finally {/);
    expect(HEALTHCHECK).toMatch(/client\.end\(\)/);
  });
});

describe('neon-healthcheck.yml (#441, NFR-S4 / AC13)', () => {
  it('never echoes the URL value or writes it into $GITHUB_ENV (NFR-S4)', () => {
    // Echoing the NAME is fine (it appears in log lines like
    // "ok: NEON_CI_READONLY_URL declares verify-full"); echoing the VALUE
    // (a $-prefixed reference in an echo/printf) is not.
    expect(WORKFLOW).not.toMatch(/echo[^\n]*\$\{?NEON_CI_READONLY_URL/);
    expect(WORKFLOW).not.toMatch(/printf[^\n]*\$\{?NEON_CI_READONLY_URL/);
    expect(WORKFLOW).not.toMatch(/GITHUB_ENV[^\n]*NEON_CI_READONLY_URL/);
  });

  it('refuses to run when the secret is missing or lacks the TLS params (AC4/AC11/AC12)', () => {
    expect(WORKFLOW).toMatch(/NEON_CI_READONLY_URL is not set/);
    expect(WORKFLOW).toMatch(/missing sslmode=verify-full/);
    expect(WORKFLOW).toMatch(/missing channel_binding=require/);
  });

  it('is scoped to the primary repository (skips on forks)', () => {
    expect(WORKFLOW).toMatch(/github\.repository == 'MaximumTrainer\/virtualrow'/);
  });

  it('runs weekly and on manual dispatch', () => {
    expect(WORKFLOW).toMatch(/workflow_dispatch/);
    expect(WORKFLOW).toMatch(/cron: '17 4 \* \* 0'/);
  });
});
