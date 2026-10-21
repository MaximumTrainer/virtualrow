import { beforeEach, describe, expect, it, vi } from 'vitest';
import { describeAdapter, isSoftwareAdapter, requestDevice } from '../device';
import { resetWebGPUHealth, readWebGPUHealth } from '../health';
import {
  installGPUStub,
  makeMockAdapter,
  makeMockGPU,
} from '../../__tests__/_mockWebGPU';

describe('device', () => {
  beforeEach(() => {
    resetWebGPUHealth();
  });

  it('describes an adapter', () => {
    const a = makeMockAdapter();
    expect(describeAdapter(a)).toContain('mock');
    const bare = { info: undefined } as unknown as GPUAdapter;
    expect(describeAdapter(bare)).toBe('unknown');
  });

  it('spots a software adapter', () => {
    expect(isSoftwareAdapter(makeMockAdapter({ software: true }))).toBe(true);
    expect(isSoftwareAdapter(makeMockAdapter({ software: false }))).toBe(false);
    expect(isSoftwareAdapter({ info: undefined } as unknown as GPUAdapter)).toBe(false);
  });

  it('falls back when WebGPU is absent', async () => {
    const session = await requestDevice(undefined);
    expect(session.state.kind).toBe('unavailable');
    expect(readWebGPUHealth()?.fallbackReason).toBe('webgpu-unsupported');
  });

  it('falls back when the adapter request throws', async () => {
    const session = await requestDevice({ gpu: makeMockGPU('throw') });
    expect(session.state).toEqual({ kind: 'unavailable', reason: 'adapter-request-failed' });
  });

  it('falls back on a software adapter', async () => {
    const session = await requestDevice({
      gpu: makeMockGPU(makeMockAdapter({ software: true })),
    });
    expect(session.state).toEqual({ kind: 'unavailable', reason: 'software-adapter' });
  });

  it('falls back on a device request failure', async () => {
    const session = await requestDevice({
      gpu: makeMockGPU(makeMockAdapter({ deviceFails: true })),
    });
    expect(session.state).toEqual({ kind: 'unavailable', reason: 'device-request-failed' });
  });

  it('returns a device on success', async () => {
    const session = await requestDevice({ gpu: makeMockGPU(makeMockAdapter()) });
    expect(session.state.kind).toBe('ready');
    session.dispose();
    // Disposing twice is a no-op.
    session.dispose();
  });

  it('notifies the caller on device loss and marks second loss as unavailable', async () => {
    const onDeviceLost = vi.fn();
    const session = await requestDevice(
      { gpu: makeMockGPU(makeMockAdapter()) },
      { onDeviceLost, isRetry: false },
    );
    expect(session.state.kind).toBe('ready');
    if (session.state.kind !== 'ready') return;
    (session.state.device as unknown as { __triggerLost(): void }).__triggerLost();
    await Promise.resolve();
    expect(onDeviceLost).toHaveBeenCalledWith(null);
    expect(readWebGPUHealth()?.deviceLostCount).toBe(1);

    // A retry whose device also dies lifts the fallback to renderer-unavailable.
    const onSecondLost = vi.fn();
    const retry = await requestDevice(
      { gpu: makeMockGPU(makeMockAdapter()) },
      { onDeviceLost: onSecondLost, isRetry: true },
    );
    if (retry.state.kind !== 'ready') throw new Error('expected ready');
    (retry.state.device as unknown as { __triggerLost(): void }).__triggerLost();
    await Promise.resolve();
    expect(onSecondLost).toHaveBeenCalledWith('renderer-unavailable');
    expect(readWebGPUHealth()?.fallbackReason).toBe('renderer-unavailable');
  });

  it('installs the GPU stub for integration', () => {
    installGPUStub(makeMockGPU(makeMockAdapter()));
    expect((globalThis.navigator as unknown as { gpu?: unknown }).gpu).toBeTruthy();
    installGPUStub(undefined);
    expect((globalThis.navigator as unknown as { gpu?: unknown }).gpu).toBeUndefined();
  });
});
