import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { useWebGPUDevice, type WebGPUDeviceState } from '../webgpu/useWebGPUDevice';
import { resetWebGPUHealth } from '../webgpu/health';

const Probe: React.FC<{ onState: (s: WebGPUDeviceState) => void }> = ({ onState }) => {
  const state = useWebGPUDevice();
  onState(state);
  return null;
};

const flush = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
};

const stubNavigatorGpu = (gpu: unknown) => {
  Object.defineProperty(globalThis.navigator, 'gpu', {
    value: gpu,
    configurable: true,
  });
};

afterEach(() => {
  resetWebGPUHealth();
  stubNavigatorGpu(undefined);
});

describe('useWebGPUDevice (#498 FR1)', () => {
  it('falls back when navigator.gpu is missing', async () => {
    stubNavigatorGpu(undefined);
    const states: WebGPUDeviceState[] = [];
    render(<Probe onState={(s) => states.push(s)} />);
    await flush();
    expect(states.at(-1)).toEqual({ kind: 'fallback', reason: 'webgpu-unsupported' });
  });

  it('falls back on a software adapter (D5-c)', async () => {
    stubNavigatorGpu({
      requestAdapter: () =>
        Promise.resolve({
          info: { vendor: 'Google', architecture: 'SwiftShader' },
          requestDevice: () => Promise.resolve({}),
        }),
    });
    const states: WebGPUDeviceState[] = [];
    render(<Probe onState={(s) => states.push(s)} />);
    await flush();
    expect(states.at(-1)).toEqual({ kind: 'fallback', reason: 'software-adapter' });
  });

  it('becomes ready when a hardware adapter and a device arrive', async () => {
    const device = { destroy: vi.fn(), lost: new Promise(() => undefined) };
    const adapter = {
      info: { vendor: 'nvidia', architecture: 'ada' },
      requestDevice: () => Promise.resolve(device),
    };
    stubNavigatorGpu({ requestAdapter: () => Promise.resolve(adapter) });
    const states: WebGPUDeviceState[] = [];
    render(<Probe onState={(s) => states.push(s)} />);
    await flush();
    const last = states.at(-1)!;
    expect(last.kind).toBe('ready');
    if (last.kind === 'ready') expect(last.device).toBe(device);
  });

  it('falls back when requestAdapter returns null', async () => {
    stubNavigatorGpu({ requestAdapter: () => Promise.resolve(null) });
    const states: WebGPUDeviceState[] = [];
    render(<Probe onState={(s) => states.push(s)} />);
    await flush();
    expect(states.at(-1)).toEqual({ kind: 'fallback', reason: 'adapter-request-failed' });
  });

  it('falls back when requestDevice throws', async () => {
    stubNavigatorGpu({
      requestAdapter: () =>
        Promise.resolve({
          info: { vendor: 'nvidia', architecture: 'ada' },
          requestDevice: () => Promise.reject(new Error('nope')),
        }),
    });
    const states: WebGPUDeviceState[] = [];
    render(<Probe onState={(s) => states.push(s)} />);
    await flush();
    expect(states.at(-1)).toEqual({ kind: 'fallback', reason: 'device-request-failed' });
  });
});
