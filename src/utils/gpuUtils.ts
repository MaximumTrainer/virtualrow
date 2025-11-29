/**
 * GPU detection and initialization utilities for WebGPU with WebGL fallback.
 * 
 * This module provides utilities for detecting GPU capabilities and
 * creating the appropriate renderer (WebGPU or WebGL).
 */

/**
 * Check if WebGPU is available in the current browser.
 * WebGPU requires both the navigator.gpu API and a compatible adapter.
 */
export async function isWebGPUAvailable(): Promise<boolean> {
  try {
    if (!navigator.gpu) {
      return false;
    }
    const adapter = await navigator.gpu.requestAdapter();
    return adapter !== null;
  } catch {
    return false;
  }
}

/**
 * Synchronous check for WebGPU API presence (doesn't verify adapter availability).
 * Use isWebGPUAvailable() for a complete check.
 */
export function hasWebGPUAPI(): boolean {
  return typeof navigator !== 'undefined' && 'gpu' in navigator;
}

/**
 * Check if WebGL is available in the current browser.
 */
export function isWebGLAvailable(): boolean {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    return !!gl;
  } catch {
    return false;
  }
}

/**
 * Get the preferred GPU backend based on availability.
 * Returns 'webgpu' if WebGPU is available, otherwise 'webgl'.
 */
export async function getPreferredGPUBackend(): Promise<'webgpu' | 'webgl'> {
  if (await isWebGPUAvailable()) {
    return 'webgpu';
  }
  return 'webgl';
}

/**
 * GPU capability information returned by detectGPUCapabilities.
 */
export interface GPUCapabilities {
  /** Whether WebGPU is available */
  webgpu: boolean;
  /** Whether WebGL 2 is available */
  webgl2: boolean;
  /** Whether WebGL 1 is available */
  webgl: boolean;
  /** The recommended backend to use */
  recommended: 'webgpu' | 'webgl';
}

/**
 * Detect all GPU capabilities asynchronously.
 */
export async function detectGPUCapabilities(): Promise<GPUCapabilities> {
  const webgpu = await isWebGPUAvailable();
  
  let webgl2 = false;
  let webgl = false;
  
  try {
    const canvas = document.createElement('canvas');
    webgl2 = !!canvas.getContext('webgl2');
    webgl = !!canvas.getContext('webgl') || !!canvas.getContext('experimental-webgl');
  } catch {
    // Ignore errors
  }
  
  return {
    webgpu,
    webgl2,
    webgl,
    recommended: webgpu ? 'webgpu' : 'webgl',
  };
}
