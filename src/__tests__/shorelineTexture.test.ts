import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { installCanvasMock } from './canvasMock';
import {
  SHORELINE_TEXTURE_SIZE,
  createShorelineTexture,
} from '../components/rower3d/shorelineTexture';

/**
 * Issue #334 — the foam line is decoration, and fails like decoration.
 *
 * jsdom has no 2D context unless one is stubbed in, which is also the state a
 * browser lands in when canvas is blocked or the context limit is reached. A
 * scene that throws there has turned a missing gradient into a missing river.
 */
describe('createShorelineTexture', () => {
  it('returns nothing rather than throwing where there is no context to draw in', () => {
    expect(() => createShorelineTexture()).not.toThrow();
    expect(createShorelineTexture()).toBeNull();
  });

  describe('with a canvas to draw into', () => {
    let uninstall: () => void;
    beforeAll(() => {
      uninstall = installCanvasMock();
    });
    afterAll(() => uninstall());

    it('draws the gradient across the strip', () => {
      const texture = createShorelineTexture();

      expect(texture, 'no texture was produced').not.toBeNull();
      expect(texture!.image.width).toBe(SHORELINE_TEXTURE_SIZE);
      // One row: the gradient varies across the strip and repeats along it.
      expect(texture!.image.height).toBe(1);
    });
  });
});
