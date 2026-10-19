import { describe, it, expect } from 'vitest';
import { describeAdapter, isSoftwareAdapter } from '../webgpu/isSoftwareAdapter';
import type { WebGPUAdapter } from '../webgpu/types';

const adapter = (overrides: {
  isFallbackAdapter?: boolean;
  info?: { vendor?: string; architecture?: string; device?: string; description?: string };
}) => overrides as unknown as WebGPUAdapter;

describe('isSoftwareAdapter (#498 D5-c)', () => {
  it('rejects an explicit fallback adapter', () => {
    expect(isSoftwareAdapter(adapter({ isFallbackAdapter: true }))).toBe(true);
  });

  it('rejects a SwiftShader architecture, case-insensitive', () => {
    expect(
      isSoftwareAdapter(adapter({ info: { vendor: 'Google', architecture: 'SwiftShader' } })),
    ).toBe(true);
    expect(
      isSoftwareAdapter(adapter({ info: { vendor: 'google', architecture: 'swiftshader' } })),
    ).toBe(true);
  });

  it('rejects llvmpipe and Microsoft Basic Render too', () => {
    expect(
      isSoftwareAdapter(adapter({ info: { vendor: 'Mesa', architecture: 'llvmpipe' } })),
    ).toBe(true);
    expect(
      isSoftwareAdapter(adapter({ info: { description: 'Microsoft Basic Render Driver' } })),
    ).toBe(true);
  });

  it('accepts a real hardware vendor', () => {
    expect(
      isSoftwareAdapter(adapter({ info: { vendor: 'nvidia', architecture: 'ada-lovelace' } })),
    ).toBe(false);
  });

  it('accepts an adapter without info rather than guessing', () => {
    expect(isSoftwareAdapter(adapter({}))).toBe(false);
  });
});

describe('describeAdapter', () => {
  it('joins vendor, architecture and device when they are set', () => {
    expect(
      describeAdapter(
        adapter({ info: { vendor: 'nvidia', architecture: 'ada', device: 'rtx-4090' } }),
      ),
    ).toBe('nvidia / ada / rtx-4090');
  });

  it('returns "unknown" when info is missing', () => {
    expect(describeAdapter(adapter({}))).toBe('unknown');
  });
});
