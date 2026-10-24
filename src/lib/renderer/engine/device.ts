/**
 * Device + adapter request, with the fallback rules from #498 (ported, not
 * imported, per D7-c of #550). Software adapters are rejected; a lost device
 * is re-requested once; a second loss or no WebGPU surfaces as
 * `renderer-unavailable`.
 */

/// <reference types="@webgpu/types" />

import {
  publishAdapter,
  publishDeviceLost,
  publishFallback,
  type WebGPUFallbackReason,
} from './health';

const SOFTWARE_HINTS = [
  'swiftshader',
  'software',
  'microsoft basic render',
  'llvmpipe',
];

export const isSoftwareAdapter = (adapter: GPUAdapter): boolean => {
  if ((adapter as GPUAdapter & { isFallbackAdapter?: boolean }).isFallbackAdapter) {
    return true;
  }
  const info = (adapter as GPUAdapter & { info?: GPUAdapterInfo }).info;
  if (!info) return false;
  const haystack = `${info.vendor ?? ''} ${info.architecture ?? ''} ${info.description ?? ''}`.toLowerCase();
  return SOFTWARE_HINTS.some((hint) => haystack.includes(hint));
};

export const describeAdapter = (adapter: GPUAdapter): string => {
  const info = (adapter as GPUAdapter & { info?: GPUAdapterInfo }).info;
  if (!info) return 'unknown';
  const parts = [info.vendor, info.architecture, info.device].filter(
    (p): p is string => typeof p === 'string' && p.length > 0,
  );
  return parts.length > 0 ? parts.join(' / ') : 'unknown';
};

export type DeviceState =
  | { kind: 'pending' }
  | { kind: 'ready'; device: GPUDevice; adapter: GPUAdapter; software: false }
  | { kind: 'unavailable'; reason: WebGPUFallbackReason };

export interface DeviceSession {
  readonly state: DeviceState;
  /** Call to release the current device. Idempotent. */
  dispose(): void;
}

export interface RequestDeviceOptions {
  /**
   * Called when the current device is lost. The engine uses this to re-attach
   * passes to the new device. If the second attempt also fails the session's
   * state transitions to `unavailable` and the engine stops drawing.
   */
  onDeviceLost?(reason: WebGPUFallbackReason | null): void;
  /** True after the device has been re-requested once already. */
  isRetry?: boolean;
}

/**
 * Request a device and manage its lifecycle. The function resolves with
 * either `ready` or `unavailable`; `pending` is only observable from an
 * external poll before the promise settles.
 */
export const requestDevice = async (
  nav: { gpu?: GPU } | undefined,
  opts: RequestDeviceOptions = {},
): Promise<DeviceSession> => {
  if (!nav?.gpu) {
    publishFallback('webgpu-unsupported');
    return makeUnavailable('webgpu-unsupported');
  }

  let adapter: GPUAdapter | null;
  try {
    adapter = await nav.gpu.requestAdapter({ powerPreference: 'high-performance' });
  } catch {
    publishFallback('adapter-request-failed');
    return makeUnavailable('adapter-request-failed');
  }
  if (!adapter) {
    publishFallback('adapter-request-failed');
    return makeUnavailable('adapter-request-failed');
  }

  const software = isSoftwareAdapter(adapter);
  publishAdapter(describeAdapter(adapter), software);
  if (software) {
    publishFallback('software-adapter');
    return makeUnavailable('software-adapter');
  }

  let device: GPUDevice;
  try {
    // Opt in to BC compressed-texture support when the adapter has it (D4-b of
    // #562, AC8). The KTX2 → BC7 path in `textureLoader` only runs on `high`+
    // tiers, and the loader itself falls through to the uncompressed PNG when
    // the feature is absent; requesting it is cheap and keeps the device
    // capable of sampling the BC7 flora atlas on hardware that supports it.
    const requiredFeatures: GPUFeatureName[] = [];
    if (adapter.features.has('texture-compression-bc')) {
      requiredFeatures.push('texture-compression-bc');
    }
    device = await adapter.requestDevice({ requiredFeatures });
  } catch {
    publishFallback('device-request-failed');
    return makeUnavailable('device-request-failed');
  }

  let disposed = false;
  const session: DeviceSession = {
    state: { kind: 'ready', device, adapter, software: false },
    dispose() {
      if (disposed) return;
      disposed = true;
      device.destroy();
    },
  };

  void device.lost.then(() => {
    if (disposed) return;
    publishDeviceLost();
    if (opts.isRetry) {
      publishFallback('renderer-unavailable');
      opts.onDeviceLost?.('renderer-unavailable');
      return;
    }
    opts.onDeviceLost?.(null);
  });

  return session;
};

const makeUnavailable = (reason: WebGPUFallbackReason): DeviceSession => ({
  state: { kind: 'unavailable', reason },
  dispose() {
    /* nothing to release */
  },
});
