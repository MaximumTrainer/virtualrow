import { useEffect, useState } from 'react';
import type { WebGPUAdapter, WebGPUDevice, WebGPUFallbackReason } from './types';
import { describeAdapter, isSoftwareAdapter } from './isSoftwareAdapter';
import { publishAdapter, publishDeviceLost, publishFallback } from './health';

/**
 * Request a `GPUDevice` on mount, dispose on unmount, re-request on
 * `deviceLost` (#498 FR1).
 *
 * The hook never throws for an unsupported browser. It returns a tagged
 * union: `ready` with a device, or `fallback` with the reason the spike
 * should fall through to the CPU path. D5-c folds in the software-adapter
 * check: a SwiftShader-like adapter counts as unavailable here even though
 * the API answered.
 */
export type WebGPUDeviceState =
  | { kind: 'pending' }
  | { kind: 'ready'; device: WebGPUDevice; adapter: WebGPUAdapter }
  | { kind: 'fallback'; reason: WebGPUFallbackReason };

interface Navigator { gpu?: { requestAdapter(options?: { powerPreference?: string }): Promise<WebGPUAdapter | null> } }

export const useWebGPUDevice = (): WebGPUDeviceState => {
  const [state, setState] = useState<WebGPUDeviceState>({ kind: 'pending' });

  useEffect(() => {
    let cancelled = false;
    let disposed = false;
    let currentDevice: GPUDevice | null = null;

    const fallback = (reason: WebGPUFallbackReason) => {
      if (cancelled) return;
      publishFallback(reason);
      setState({ kind: 'fallback', reason });
    };

    const nav = (globalThis.navigator as unknown as Navigator | undefined);
    if (!nav?.gpu) {
      fallback('webgpu-unsupported');
      return () => {
        cancelled = true;
      };
    }

    const request = async () => {
      let adapter: WebGPUAdapter | null;
      try {
        adapter = await nav.gpu!.requestAdapter({ powerPreference: 'high-performance' });
      } catch {
        fallback('adapter-request-failed');
        return;
      }
      if (!adapter) {
        fallback('adapter-request-failed');
        return;
      }
      const software = isSoftwareAdapter(adapter);
      publishAdapter(describeAdapter(adapter), software);
      if (software) {
        fallback('software-adapter');
        return;
      }
      let device: WebGPUDevice;
      try {
        device = await adapter.requestDevice();
      } catch {
        fallback('device-request-failed');
        return;
      }
      if (cancelled || disposed) {
        device.destroy();
        return;
      }
      currentDevice = device;
      void device.lost.then(() => {
        if (disposed) return;
        publishDeviceLost();
        currentDevice = null;
        void request();
      });
      setState({ kind: 'ready', device, adapter });
    };

    void request();

    return () => {
      cancelled = true;
      disposed = true;
      currentDevice?.destroy();
      currentDevice = null;
    };
  }, []);

  return state;
};
