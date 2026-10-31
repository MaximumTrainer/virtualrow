/**
 * The real crash-report transport (issue #473, FR5, D1 = a).
 *
 * Phase 1 shipped a stub that only `console.info`d the payload; Phase 3 adds
 * this factory, which the composition root uses when
 * `VITE_CRASH_REPORT_ENDPOINT` is baked into the build. The endpoint is
 * `https://api.github.com/repos/maximum-trainer/virtualrow/dispatches`
 * (`repository_dispatch`), and the token is a fine-grained GitHub token with
 * `repo:dispatch` scope on this repository only (NFR5): it is baked at build
 * time via `VITE_CRASH_REPORT_TOKEN` and NEVER logged.
 *
 * On any non-2xx response or network error the transport throws. The
 * reporter catches the throw and applies FR10's two-retry schedule itself —
 * keeping retry policy outside the transport keeps a Phase 4 proxy swap
 * drop-in.
 */
import type { CrashPayload } from '../types/crashPayload';

/** The repository_dispatch event_type that the Phase 4 workflow listens on. */
export const CRASH_DISPATCH_EVENT_TYPE = 'crash_report';

/** A failed transport's exception type so the reporter can read it uniformly. */
export class CrashTransportError extends Error {
  readonly status: number | null;
  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = 'CrashTransportError';
    this.status = status;
  }
}

/**
 * Make a GitHub `repository_dispatch` transport.
 *
 * The function is pure of module state: the composition root constructs one
 * instance from the baked env vars and hands it to `CrashReporterService`.
 * Tests pass their own transport, so this factory is never called under
 * Vitest.
 */
export const makeRepositoryDispatchTransport = (
  endpoint: string,
  token: string,
): ((payload: CrashPayload) => Promise<void>) => {
  if (!endpoint || !token) {
    // A caller that forgot one half of the pair gets a transport that no-ops
    // — matches the "endpoint unset" branch so the service never calls it.
    return async () => {
      throw new CrashTransportError('endpoint or token missing');
    };
  }
  return async (payload) => {
    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Accept: 'application/vnd.github+json',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'X-GitHub-Api-Version': '2022-11-28',
        },
        // GitHub's `repository_dispatch` API caps `client_payload` at 10
        // top-level keys; `CrashPayload` has 11, so the payload is nested
        // under a single `payload` key. The Phase 4 `crash-triage` workflow
        // (`scripts/crash-triage.mjs`) reads it from the same key.
        body: JSON.stringify({
          event_type: CRASH_DISPATCH_EVENT_TYPE,
          client_payload: { payload },
        }),
      });
    } catch (err) {
      // Network error, DNS failure, CORS block. The reporter will retry.
      const message = err instanceof Error ? err.message : String(err);
      // Never include `token` in the message. The token lives only in the
      // Authorization header above.
      throw new CrashTransportError(`network: ${message}`);
    }
    if (!response.ok) {
      throw new CrashTransportError(
        `dispatch returned ${response.status}`,
        response.status,
      );
    }
  };
};
