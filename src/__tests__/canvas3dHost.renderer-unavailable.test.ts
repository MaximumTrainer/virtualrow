import { render, waitFor } from '@testing-library/svelte';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import Canvas3DHost from '../lib/ui/Canvas3DHost.svelte';
import type { RideAttach } from '../lib/ui/rideCanvas';
import { crashReporterService } from '../lib/services/crashReporterService';
import type { CrashPayload } from '../lib/types/crashPayload';

// #542 AC11 / FR11: when the WebGPU engine declines (software adapter, no
// `navigator.gpu`, or an attach throw), the host reports exactly one
// `renderer-unavailable` crash so the triage pipeline can see it.
describe('Canvas3DHost renderer-unavailable telemetry', () => {
  // vi.spyOn's inferred shape and the ReportResult generic don't line up
  // under this tsconfig, so widen the spy to its mock-API surface.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let spy: any;

  beforeEach(() => {
    spy = vi
      .spyOn(crashReporterService, 'reportCrash')
      .mockResolvedValue({ submitted: true });
  });

  afterEach(() => {
    spy.mockRestore();
  });

  const kindOf = (call: unknown[]): CrashKindOrNull => {
    const payload = call[0] as Partial<CrashPayload> | undefined;
    return (payload?.kind ?? null) as CrashKindOrNull;
  };

  it('reports a renderer-unavailable crash when attach returns null', async () => {
    const attach = vi.fn<RideAttach>(() => null);
    render(Canvas3DHost, { attach });

    await waitFor(() => {
      expect(spy).toHaveBeenCalledTimes(1);
    });
    expect(kindOf(spy.mock.calls[0] as unknown[])).toBe('renderer-unavailable');
  });

  it('reports a renderer-unavailable crash when attach throws', async () => {
    const attach = vi.fn<RideAttach>(() => {
      throw new Error('no adapter');
    });
    render(Canvas3DHost, { attach });

    await waitFor(() => {
      expect(spy).toHaveBeenCalledTimes(1);
    });
    expect(kindOf(spy.mock.calls[0] as unknown[])).toBe('renderer-unavailable');
  });

  it('does not report when the engine attaches successfully', async () => {
    const attach = vi.fn<RideAttach>(() => ({ dispose: () => {} }));
    render(Canvas3DHost, { attach });
    await Promise.resolve();
    await Promise.resolve();

    expect(spy).not.toHaveBeenCalled();
  });
});

type CrashKindOrNull = CrashPayload['kind'] | null;
