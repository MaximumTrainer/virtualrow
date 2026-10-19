import type { WebGPUAdapter, WebGPUAdapterInfo } from './types';

/**
 * Heuristic for D5-c: fall back when the adapter is a software renderer.
 *
 * `GPUAdapter.info` carries `vendor` and `architecture` strings whose values
 * are driver-defined. The two signals we go on are the explicit `isFallback`
 * flag three.js and friends have grown around (a hint that the adapter did
 * not come from a dedicated GPU) and the vendor/architecture strings
 * containing a known software renderer. Browsers that light SwiftShader as
 * their WebGPU backend report `"swiftshader"` in `architecture`.
 *
 * Everything is case-insensitive; a vendor that calls itself "SwiftShader"
 * and one that calls itself "swiftshader" both fail the check.
 */
const SOFTWARE_HINTS = [
  'swiftshader',
  'software',
  'microsoft basic render',
  'llvmpipe',
];

export const isSoftwareAdapter = (adapter: WebGPUAdapter): boolean => {
  if ((adapter as WebGPUAdapter & { isFallbackAdapter?: boolean }).isFallbackAdapter) {
    return true;
  }
  const info = (adapter as WebGPUAdapter & { info?: WebGPUAdapterInfo }).info;
  if (!info) return false;
  const haystack = `${info.vendor ?? ''} ${info.architecture ?? ''} ${info.description ?? ''}`.toLowerCase();
  return SOFTWARE_HINTS.some((hint) => haystack.includes(hint));
};

export const describeAdapter = (adapter: WebGPUAdapter): string => {
  const info = (adapter as WebGPUAdapter & { info?: WebGPUAdapterInfo }).info;
  if (!info) return 'unknown';
  const parts = [info.vendor, info.architecture, info.device].filter((p) => p && p.length > 0);
  return parts.length > 0 ? parts.join(' / ') : 'unknown';
};
