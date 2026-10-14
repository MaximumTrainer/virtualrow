#!/usr/bin/env node
/**
 * CLI entrypoint for `.github/workflows/crash-triage.yml`.
 *
 * Reads the `repository_dispatch` payload from `GITHUB_EVENT_PATH`, wires
 * an authenticated `@octokit/rest` client from `GITHUB_TOKEN`, and prints
 * the triage outcome. Vitest never loads this file — the unit suite drives
 * `triageCrashReport` directly through `crash-triage.mjs`.
 */
import { readFile } from 'node:fs/promises';
import { Octokit } from '@octokit/rest';
import { triageCrashReport } from './crash-triage.mjs';

async function main() {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  const token = process.env.GITHUB_TOKEN;
  const repoFull = process.env.GITHUB_REPOSITORY;
  if (!eventPath || !token || !repoFull) {
    console.error('crash-triage: missing GITHUB_EVENT_PATH, GITHUB_TOKEN, or GITHUB_REPOSITORY');
    process.exit(1);
  }
  const [owner, repo] = repoFull.split('/');
  const event = JSON.parse(await readFile(eventPath, 'utf8'));
  // The browser-side transport wraps the CrashPayload in a `payload` key so
  // the dispatch stays under GitHub's 10-key client_payload cap; a legacy
  // call that posts the bare payload still works.
  const envelope = event?.client_payload;
  const payload = envelope?.payload ?? envelope;
  const octokit = new Octokit({ auth: token });
  const outcome = await triageCrashReport({
    payload,
    octokit,
    owner,
    repo,
    nowMs: Date.now(),
  });
  console.log(JSON.stringify(outcome, null, 2));
}

main().catch((err) => {
  console.error('crash-triage: fatal:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
