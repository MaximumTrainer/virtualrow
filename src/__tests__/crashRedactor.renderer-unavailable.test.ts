import { describe, it, expect } from 'vitest';

import { redactCrashPayload } from '../lib/utils/crashRedactor';

// #542 AC11 (FR11): the "needs WebGPU" path records a `renderer-unavailable`
// crash so the triage pipeline sees how often the engine declines.
describe('crashRedactor renderer-unavailable kind', () => {
  it('preserves `kind: renderer-unavailable` through the allowlist', () => {
    const out = redactCrashPayload({ kind: 'renderer-unavailable' });
    expect(out.kind).toBe('renderer-unavailable');
  });

  it('keeps authFailure null for a renderer-unavailable payload', () => {
    const out = redactCrashPayload({ kind: 'renderer-unavailable' });
    expect(out.authFailure).toBeNull();
  });

  it('carries the verdict reason through for a renderer-unavailable payload', () => {
    const out = redactCrashPayload({
      kind: 'renderer-unavailable',
      verdict: { crashed: true, reason: 'software-adapter' },
    });
    expect(out.verdict.reason).toBe('software-adapter');
  });
});
