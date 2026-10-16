// ============================================================================
// Verify the intervals.icu OAuth CORS proxy accepts a VirtualRow origin.
//
// Issue #486 Phase 3 (D8 = c, FR4 + AC7). The Cloudflare Worker that proxies
// `https://intervals.icu/api/oauth/token` reads its `ALLOWED_ORIGINS` list on
// deploy; when a VirtualRow origin is missing from that list the browser
// pre-flight (`OPTIONS /proxy/api/oauth/token`) is refused and sign-in fails
// with the generic exchange error. This script sends that preflight for each
// origin a maintainer gives it and reports whether the Worker echoed it back
// in `Access-Control-Allow-Origin` (ACAO).
//
// Default origins mirror DEVELOPMENT.md §"intervals.icu OAuth Proxy":
//   http://localhost:5173, http://127.0.0.1:5173, https://maximumtrainer.github.io
// Override with ORIGINS="https://a,https://b" or --origin https://a repeated.
// Override the proxy URL (for a staging worker) with
//   VIRTUALROW_INTERVALS_PROXY_URL=https://.../proxy/api/oauth/token
//
// Exit code: 0 when every origin is echoed back and the status is 2xx,
// otherwise 1 — this is a maintainer tool, not a scheduled job, so it hard-
// errors on mismatch. The scheduled workflow in
// `.github/workflows/intervals-proxy-healthcheck.yml` reuses the same checks
// but issues a GitHub warning instead of failing, per project convention
// (main stays green on scheduled runs).
// ============================================================================

const DEFAULT_PROXY_URL =
  'https://mt-intervals-proxy.intervals-login.workers.dev/proxy/api/oauth/token';
const DEFAULT_ORIGINS = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'https://maximumtrainer.github.io',
];

const parseOrigins = () => {
  const fromEnv = process.env.ORIGINS;
  if (fromEnv && fromEnv.trim() !== '') {
    return fromEnv.split(',').map((s) => s.trim()).filter(Boolean);
  }
  const fromArgs = [];
  for (let i = 2; i < process.argv.length; i += 1) {
    if (process.argv[i] === '--origin' && process.argv[i + 1]) {
      fromArgs.push(process.argv[i + 1]);
      i += 1;
    }
  }
  return fromArgs.length > 0 ? fromArgs : DEFAULT_ORIGINS;
};

const proxyUrl = process.env.VIRTUALROW_INTERVALS_PROXY_URL ?? DEFAULT_PROXY_URL;
const origins = parseOrigins();

/**
 * Send a CORS pre-flight for `origin` to the token endpoint and read back the
 * Worker's verdict. A browser only talks to the proxy after this preflight
 * succeeds, so this call is exactly the gate the real sign-in flow trips on.
 */
const check = async (origin) => {
  try {
    const res = await fetch(proxyUrl, {
      method: 'OPTIONS',
      headers: {
        Origin: origin,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'content-type',
      },
    });
    const acao = res.headers.get('access-control-allow-origin');
    const ok = res.ok && (acao === origin || acao === '*');
    return { origin, status: res.status, acao, ok };
  } catch (err) {
    return {
      origin,
      status: null,
      acao: null,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
};

const main = async () => {
  console.log(`Checking ${proxyUrl}`);
  console.log(`Origins: ${origins.join(', ')}`);
  console.log('');

  const results = await Promise.all(origins.map(check));

  let allGood = true;
  for (const r of results) {
    const tag = r.ok ? 'OK   ' : 'FAIL ';
    const detail = r.error
      ? `network error: ${r.error}`
      : `status=${r.status} acao=${r.acao ?? '(none)'}`;
    console.log(`${tag} ${r.origin}  ${detail}`);
    if (!r.ok) allGood = false;
  }

  if (!allGood) {
    console.log('');
    console.log(
      'One or more origins were not echoed back. Update ALLOWED_ORIGINS in',
    );
    console.log(
      'MaximumTrainer_Redux/workers/intervals-cors-proxy/worker.js and redeploy',
    );
    console.log('with `npx wrangler deploy`.');
    process.exit(1);
  }
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
