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

  it('asks for texture-compression-bc when the adapter has it (#562 AC8)', async () => {
    // Replace the adapter's requestDevice with a spy that captures the opts
    // and still returns the mock device shape the real one does. The device
    // itself comes from a sibling makeMockAdapter — one real call so the
    // `lost` promise is wired up and the test does not throw at teardown.
    const inner = makeMockAdapter();
    const innerDevice = await inner.requestDevice();
    const adapter = makeMockAdapter();
    (adapter as unknown as { features: Set<string> }).features = new Set(['texture-compression-bc']);
    let seenFeatures: readonly string[] = [];
    (adapter as unknown as { requestDevice: unknown }).requestDevice = async (opts?: {
      requiredFeatures?: readonly string[];
    }) => {
      seenFeatures = opts?.requiredFeatures ?? [];
      return innerDevice;
    };
    const session = await requestDevice({ gpu: makeMockGPU(adapter) });
    expect(session.state.kind).toBe('ready');
    expect(seenFeatures).toContain('texture-compression-bc');
  });

  it('omits texture-compression-bc when the adapter cannot do it', async () => {
    const inner = makeMockAdapter();
    const innerDevice = await inner.requestDevice();
    const adapter = makeMockAdapter();
    let seenFeatures: readonly string[] | undefined;
    (adapter as unknown as { requestDevice: unknown }).requestDevice = async (opts?: {
      requiredFeatures?: readonly string[];
    }) => {
      seenFeatures = opts?.requiredFeatures;
      return innerDevice;
    };
    const session = await requestDevice({ gpu: makeMockGPU(adapter) });
    expect(session.state.kind).toBe('ready');
    expect(seenFeatures).toEqual([]);
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
