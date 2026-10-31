import { afterEach, describe, expect, it } from 'vitest';
import {
  publishAdapter,
  publishDeviceLost,
  publishFallback,
  readWebGPUHealth,
  resetWebGPUHealth,
} from '../health';

afterEach(() => resetWebGPUHealth());

describe('health', () => {
  it('starts unpublished', () => {
    expect(readWebGPUHealth()).toBeUndefined();
  });

  it('publishes adapter, loss and fallback', () => {
    publishAdapter('mock', false);
    publishDeviceLost();
    publishDeviceLost();
    publishFallback('device-lost');
    const h = readWebGPUHealth();
    expect(h).toMatchObject({ adapter: 'mock', isSoftware: false, deviceLostCount: 2, fallbackReason: 'device-lost' });
  });

  it('resets', () => {
    publishAdapter('mock', true);
    resetWebGPUHealth();
    expect(readWebGPUHealth()).toBeUndefined();
  });
});
