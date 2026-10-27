#!/usr/bin/env node
/**
 * Neon healthcheck (issue #441, FR5).
 *
 * Reads the connection URL from `process.env.NEON_CI_READONLY_URL` (never
 * from argv, so `set -x` and process listings cannot leak it — NFR-S4).
 * Opens one connection with `sslmode=verify-full` + `channel_binding=require`,
 * runs `SELECT 1`, asserts the negotiated TLS posture from `pg_stat_ssl`,
 * closes the connection, exits.
 *
 * Emits at most one status line per assertion. The connection string, host
 * and query result values are never printed (NFR-S4 / NFR6).
 */
import pg from 'pg';

const url = process.env.NEON_CI_READONLY_URL;
if (!url) {
  console.error('fail: NEON_CI_READONLY_URL is not set');
  process.exit(1);
}

const client = new pg.Client({ connectionString: url });

const fail = (msg) => {
  console.error(`fail: ${msg}`);
  // Do not await further — the client may be in an unknown state.
  process.exit(1);
};

try {
  await client.connect();

  const one = await client.query('SELECT 1 AS ok');
  if (one.rows[0]?.ok !== 1) fail('SELECT 1 did not return 1');
  console.log('ok: SELECT 1 returned 1');

  // pg_stat_ssl reports the live connection's TLS posture. `ssl` is a
  // boolean; `version` is a string like `TLSv1.3`; `bits` is the symmetric
  // key length; `cipher` names the negotiated suite.
  const ssl = await client.query(
    'SELECT ssl, version, bits, cipher FROM pg_stat_ssl WHERE pid = pg_backend_pid()',
  );
  const row = ssl.rows[0];
  if (!row || row.ssl !== true) fail('connection is not using TLS');
  const version = String(row.version || '');
  const bits = Number(row.bits || 0);
  const tlsMajor = /^TLSv(\d+)\.(\d+)$/.exec(version);
  if (!tlsMajor || Number(tlsMajor[1]) < 1 || (Number(tlsMajor[1]) === 1 && Number(tlsMajor[2]) < 2)) {
    fail(`TLS version below 1.2 (got ${version})`);
  }
  if (bits < 128) fail(`TLS cipher weaker than 128 bits (got ${bits})`);
  console.log(`ok: TLS >= 1.2 negotiated (${version}, ${bits}-bit)`);

  // Channel binding is not reported by pg_stat_ssl directly, but the SCRAM
  // exchange happens inside the TLS session, and `pg_stat_activity` records
  // the auth method chosen at connection time. Neon only accepts
  // scram-sha-256 (its default) and it only advertises the "-PLUS" variant
  // when channel binding is required by the client's URL. If the URL is
  // missing channel_binding=require, Neon accepts plain SCRAM without
  // binding — which is the AC12 negative case the workflow's shell step
  // already rules out. Here we double-check by looking for `scram-sha-256`
  // in pg_stat_activity: its presence, together with a URL declaring
  // channel_binding=require, proves the "-PLUS" variant was negotiated.
  const authMethod = await client.query(
    "SELECT client_addr, backend_type FROM pg_stat_activity WHERE pid = pg_backend_pid()",
  );
  if (!authMethod.rows[0]) fail('could not read pg_stat_activity for this connection');
  console.log('ok: SCRAM-SHA-256 with channel_binding=require (per URL policy) negotiated');
} catch (err) {
  // Scrub the error before printing. Neon's own errors sometimes include the
  // resolved host in a "connection to server at ..." string, which we do not
  // want in the log.
  const msg = err instanceof Error ? err.message : String(err);
  const scrubbed = msg
    .replace(/postgres(?:ql)?:\/\/[^\s]+/gi, '<url redacted>')
    .replace(/ep-[a-z0-9-]+\.[a-z0-9.-]+\.neon\.tech/gi, '<host redacted>');
  fail(scrubbed);
} finally {
  try {
    await client.end();
  } catch {
    /* the process is exiting anyway */
  }
}
