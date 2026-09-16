import { describe, it, expect, afterEach, vi } from 'vitest';
import { assetUrl } from '../utils/assetUrl';

/**
 * The deploy builds with `--base=/virtualrow/app/`, so everything in public/ is
 * published under that prefix. Asset URLs were built from the domain root, so
 * every GLB 404'd in production while the files themselves were served fine one
 * directory up. Dev and Playwright both serve from `/`, where the two agree —
 * which is exactly why nothing caught it (issue #251).
 */
const withBase = (base: string, run: () => void) => {
  vi.stubEnv('BASE_URL', base);
  try {
    run();
  } finally {
    vi.unstubAllEnvs();
  }
};

describe('assetUrl', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('prefixes the deploy base path', () => {
    withBase('/virtualrow/app/', () => {
      expect(assetUrl('/assets/boat/scull-male.glb')).toBe(
        '/virtualrow/app/assets/boat/scull-male.glb',
      );
    });
  });

  it('leaves a root deployment unchanged', () => {
    withBase('/', () => {
      expect(assetUrl('/assets/boat/scull-male.glb')).toBe('/assets/boat/scull-male.glb');
    });
  });

  it('does not double the separator, whatever shape the base has', () => {
    withBase('/virtualrow/app', () => {
      expect(assetUrl('/assets/x.glb')).toBe('/virtualrow/app/assets/x.glb');
    });
    withBase('/virtualrow/app/', () => {
      expect(assetUrl('assets/x.glb')).toBe('/virtualrow/app/assets/x.glb');
    });
  });

  it('is idempotent, so a URL that already carries the base is not prefixed twice', () => {
    withBase('/virtualrow/app/', () => {
      const once = assetUrl('/assets/x.glb');
      expect(assetUrl(once)).toBe(once);
    });
  });

  it('leaves an absolute URL alone', () => {
    withBase('/virtualrow/app/', () => {
      expect(assetUrl('https://cdn.example.com/x.glb')).toBe('https://cdn.example.com/x.glb');
    });
  });
});
