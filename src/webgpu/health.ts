import type { WebGPUFallbackReason, WebGPUHealth } from './types';

/**
 * Publish and update `window.__VIRTUALROW_WEBGPU_HEALTH` (#498 FR5).
 *
 * Nothing here reads from or writes to the DOM; it is a tiny mutable record
 * other code pokes between dispatches. The object is created lazily on the
 * first write so a page that never touches WebGPU keeps a `window` free of
 * stray state.
 */
export const readWebGPUHealth = (): WebGPUHealth | undefined =>
  window.__VIRTUALROW_WEBGPU_HEALTH;

export const resetWebGPUHealth = (): void => {
  delete window.__VIRTUALROW_WEBGPU_HEALTH;
};

const ensure = (): WebGPUHealth => {
  if (!window.__VIRTUALROW_WEBGPU_HEALTH) {
    window.__VIRTUALROW_WEBGPU_HEALTH = { deviceLostCount: 0 };
  }
  return window.__VIRTUALROW_WEBGPU_HEALTH;
};

export const publishAdapter = (adapter: string, isSoftware: boolean): void => {
  const health = ensure();
  health.adapter = adapter;
  health.isSoftware = isSoftware;
};

export const publishDeviceLost = (): void => {
  const health = ensure();
  health.deviceLostCount += 1;
};

export const publishDispatchTiming = (dispatchMs: number, mappedReadMs: number): void => {
  const health = ensure();
  health.dispatchMs = dispatchMs;
  health.mappedReadMs = mappedReadMs;
};

export const publishFallback = (reason: WebGPUFallbackReason): void => {
  const health = ensure();
  health.fallbackReason = reason;
};
