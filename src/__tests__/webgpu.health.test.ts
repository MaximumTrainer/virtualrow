import { afterEach, describe, it, expect } from 'vitest';
import {
  publishAdapter,
  publishDeviceLost,
  publishDispatchTiming,
  publishFallback,
  readWebGPUHealth,
  resetWebGPUHealth,
} from '../webgpu/health';

afterEach(() => resetWebGPUHealth());

describe('WebGPU health telemetry (#498 FR5)', () => {
  it('starts unpublished until something writes', () => {
    expect(readWebGPUHealth()).toBeUndefined();
  });

  it('publishAdapter sets adapter + isSoftware and zeroes device-lost count', () => {
    publishAdapter('nvidia / ada / rtx-4090', false);
    expect(readWebGPUHealth()).toEqual({
      adapter: 'nvidia / ada / rtx-4090',
      isSoftware: false,
      deviceLostCount: 0,
    });
  });

  it('publishDeviceLost increments across calls', () => {
    publishAdapter('x', false);
    publishDeviceLost();
    publishDeviceLost();
    expect(readWebGPUHealth()?.deviceLostCount).toBe(2);
  });

  it('publishDispatchTiming records both dispatch and mapped-read ms', () => {
    publishAdapter('x', false);
    publishDispatchTiming(0.8, 0.2);
    expect(readWebGPUHealth()).toMatchObject({ dispatchMs: 0.8, mappedReadMs: 0.2 });
  });

  it('publishFallback records the reason the CPU path kicked in', () => {
    publishFallback('webgpu-unsupported');
    expect(readWebGPUHealth()).toMatchObject({ fallbackReason: 'webgpu-unsupported' });
  });
});
