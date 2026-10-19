import { afterEach, describe, it, expect } from 'vitest';
import { isWebGPUCullEnabled } from '../webgpu/featureFlag';

afterEach(() => {
  delete window.__VIRTUALROW_WEBGPU_CULL;
});

describe('isWebGPUCullEnabled (#498 D6-c)', () => {
  it('is off by default — the spike is build-time off', () => {
    expect(isWebGPUCullEnabled()).toBe(false);
  });

  it('is on when the runtime global is explicitly true', () => {
    window.__VIRTUALROW_WEBGPU_CULL = true;
    expect(isWebGPUCullEnabled()).toBe(true);
  });

  it('stays off when the runtime global is false', () => {
    window.__VIRTUALROW_WEBGPU_CULL = false;
    expect(isWebGPUCullEnabled()).toBe(false);
  });
});
