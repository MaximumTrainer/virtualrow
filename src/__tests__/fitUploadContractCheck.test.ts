import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * NFR7 / AC13 (issue #446): the contract-check script never writes the API
 * key to stdout/stderr, and every error path scrubs URLs (which could carry
 * the token in a query) before printing.
 *
 * A unit test on the source rather than an execution-level test because
 * spawning Node to hit intervals.icu inside vitest would either (a) require
 * network, contradicting NFR3, or (b) require mocking global `fetch` inside a
 * child process — needless plumbing for what is really a small static check.
 */
const SCRIPT = readFileSync(
  resolve(__dirname, '../../scripts/run-fit-upload-contract-check.mjs'),
  'utf8',
);

describe('run-fit-upload-contract-check.mjs', () => {
  it('routes every error message through safeErrorMessage', () => {
    // The only places that print an error are the top-level `catch` and the
    // cleanup `catch`; both must go through the scrubber.
    expect(SCRIPT).toMatch(/function safeErrorMessage/);
    expect(SCRIPT).toMatch(/console\.error\([^)]*safeErrorMessage/);
    expect(SCRIPT).toMatch(/console\.warn\([^)]*safeErrorMessage/);
  });

  it('never prints an API key or Authorization header directly', () => {
    // A stray `console.log(apiKey)` or `console.log(basicAuthHeader(...))`
    // would leak the secret. Belt-and-braces: neither identifier reaches a
    // logging call in the script.
    expect(SCRIPT).not.toMatch(/console\.[a-z]+\([^)]*\bapiKey\b/);
    expect(SCRIPT).not.toMatch(/console\.[a-z]+\([^)]*basicAuthHeader/);
    expect(SCRIPT).not.toMatch(/console\.[a-z]+\([^)]*Authorization/);
  });

  it('redacts URLs in caught error messages', () => {
    // The scrubber's contract: any http(s):// substring becomes "<url redacted>".
    // A real URL would carry `?external_id=...&api_key=...`-style creds.
    expect(SCRIPT).toMatch(/https\?:\\\/\\\/\\S\+/);
    expect(SCRIPT).toMatch(/<url redacted>/);
  });

  it('is opt-in behind INTERVALS_ICU_CONTRACT_CHECK=1', () => {
    // NFR3: never runs by accident, matches the shape of run-contract-check.mjs.
    expect(SCRIPT).toMatch(/INTERVALS_ICU_CONTRACT_CHECK/);
    expect(SCRIPT).toMatch(/skipped: set INTERVALS_ICU_CONTRACT_CHECK=1 to enable/);
  });

  it('deletes any created activity in a finally block', () => {
    // D7(a) / AC3: cleanup runs even when the assertion above fails.
    expect(SCRIPT).toMatch(/} finally {/);
    expect(SCRIPT).toMatch(/deleteActivity\(/);
  });
});
