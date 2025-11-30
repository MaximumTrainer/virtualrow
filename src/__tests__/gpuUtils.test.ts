import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { isWebGLAvailable, hasWebGPUAPI } from '../utils/gpuUtils';

describe('gpuUtils', () => {
  describe('isWebGLAvailable', () => {
    let originalCreateElement: typeof document.createElement;
    
    beforeEach(() => {
      originalCreateElement = document.createElement.bind(document);
    });
    
    afterEach(() => {
      document.createElement = originalCreateElement;
    });
    
    it('returns false when canvas context is not available', () => {
      document.createElement = vi.fn().mockReturnValue({
        getContext: vi.fn().mockReturnValue(null),
      });
      expect(isWebGLAvailable()).toBe(false);
    });
    
    it('returns true when webgl2 context is available', () => {
      document.createElement = vi.fn().mockReturnValue({
        getContext: vi.fn().mockImplementation((contextType: string) => {
          if (contextType === 'webgl2') return {};
          return null;
        }),
      });
      expect(isWebGLAvailable()).toBe(true);
    });
    
    it('returns true when webgl context is available (fallback from webgl2)', () => {
      document.createElement = vi.fn().mockReturnValue({
        getContext: vi.fn().mockImplementation((contextType: string) => {
          if (contextType === 'webgl') return {};
          return null;
        }),
      });
      expect(isWebGLAvailable()).toBe(true);
    });
    
    it('returns false when an error is thrown', () => {
      document.createElement = vi.fn().mockImplementation(() => {
        throw new Error('Canvas not supported');
      });
      expect(isWebGLAvailable()).toBe(false);
    });
  });
  
  describe('hasWebGPUAPI', () => {
    it('returns false when navigator.gpu is not available', () => {
      // In JSDOM, navigator.gpu is not available
      expect(hasWebGPUAPI()).toBe(false);
    });
  });
});
