// ============================================================================
// Live intervals.icu FIT upload contract check (issue #446, FR3).
//
// Encodes nothing new: it reads the checked-in fixture at
// `src/__tests__/__fixtures__/sample-session.fit`, POSTs it directly to
// `https://intervals.icu/api/v1/athlete/{id}/activities` with HTTP Basic
// `API_KEY:<key>`, asserts a 2xx and a numeric activity id, then DELETEs the
// created activity in a `finally` (D2(a), D3(a), D7(a)). Bypasses the CORS
// proxy — Node has no cross-origin constraint.
//
// Opt-in: does nothing unless `INTERVALS_ICU_CONTRACT_CHECK=1`. Missing env
// vars past that point are a hard error, not a silent skip: the operator
// asked for a live check.
// ============================================================================

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const FIXTURE = resolve(HERE, '..', 'src/__tests__/__fixtures__/sample-session.fit');
const BASE_URL = 'https://intervals.icu';

/** Never log the secret — no `Bearer <token>`, no `Basic <base64>`, no query. */
function safeErrorMessage(err) {
  const raw = err instanceof Error ? err.message : String(err);
  // Truncate anything that looks like it might carry a URL with the auth token.
  return raw.replace(/https?:\/\/\S+/g, '<url redacted>');
}

/** HTTP Basic API_KEY:<key>, as intervals.icu's own docs describe. */
function basicAuthHeader(apiKey) {
  return `Basic ${Buffer.from(`API_KEY:${apiKey}`).toString('base64')}`;
}

async function uploadFixture(athleteId, apiKey, externalId) {
  const bytes = readFileSync(FIXTURE);
  const params = new URLSearchParams({
    name: 'VirtualRow contract check',
    description: 'Automated FIT upload contract check — safe to delete.',
    external_id: externalId,
  });
  const url = `${BASE_URL}/api/v1/athlete/${encodeURIComponent(athleteId)}/activities?${params}`;

  const form = new FormData();
  form.append('file', new Blob([bytes], { type: 'application/octet-stream' }), 'contract-check.fit');

  const response = await fetch(url, {
    method: 'POST',
    headers: { Authorization: basicAuthHeader(apiKey) },
    body: form,
  });
  if (!response.ok) {
    // Read the body but truncate it — the server may echo the URL.
    const body = await response.text().catch(() => '');
    throw new Error(`upload failed: ${response.status} ${response.statusText} — ${body.slice(0, 200)}`);
  }
  const body = await response.json();
  const activity = Array.isArray(body) ? body[0] : body;
  const id = activity && activity.id !== undefined ? String(activity.id) : '';
  if (!id) throw new Error('upload succeeded but no activity id in response');
  return id;
}

async function deleteActivity(apiKey, activityId) {
  const url = `${BASE_URL}/api/v1/activity/${encodeURIComponent(activityId)}`;
  const response = await fetch(url, {
    method: 'DELETE',
    headers: { Authorization: basicAuthHeader(apiKey) },
  });
  if (!response.ok && response.status !== 404) {
    throw new Error(`delete failed: ${response.status} ${response.statusText}`);
  }
}

async function main() {
  if (process.env.INTERVALS_ICU_CONTRACT_CHECK !== '1') {
    console.log('skipped: set INTERVALS_ICU_CONTRACT_CHECK=1 to enable');
    return 0;
  }

  const apiKey = process.env.INTERVALS_ICU_TEST_API_KEY;
  const athleteId = process.env.INTERVALS_ICU_TEST_ATHLETE_ID;
  if (!apiKey) throw new Error('INTERVALS_ICU_TEST_API_KEY is required when INTERVALS_ICU_CONTRACT_CHECK=1');
  if (!athleteId) throw new Error('INTERVALS_ICU_TEST_ATHLETE_ID is required when INTERVALS_ICU_CONTRACT_CHECK=1');

  const externalId = `virtualrow-contract-${Date.now()}`;
  let activityId = null;
  try {
    activityId = await uploadFixture(athleteId, apiKey, externalId);
    console.log(`upload ok: activity id ${activityId}`);
  } finally {
    if (activityId) {
      try {
        await deleteActivity(apiKey, activityId);
        console.log(`delete ok: activity id ${activityId}`);
      } catch (err) {
        // Cleanup failure is worth surfacing but not worth clobbering the
        // upload result the caller cares about.
        console.warn(`cleanup: could not delete activity ${activityId}: ${safeErrorMessage(err)}`);
      }
    }
  }
  return 0;
}

try {
  process.exit(await main());
} catch (err) {
  console.error(`contract check failed: ${safeErrorMessage(err)}`);
  process.exit(1);
}
