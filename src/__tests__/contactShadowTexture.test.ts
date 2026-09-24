import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { installCanvasMock } from './canvasMock';
import {
  createContactShadowTexture,
  CONTACT_SHADOW_RADIUS_M,
  CONTACT_SHADOW_OPACITY,
} from '../components/rower3d/contactShadowTexture';

/**
 * Issue #352 — the shadow where the hull meets the water.
 *
 * Without one the boat sits *on* the river rather than *in* it, however good
 * the directional shadow is — and on the `low` tier, which casts none at all,
 * it is the only thing joining the two.
 *
 * Drawn as one textured plane rather than with drei's `ContactShadows`. That
 * component renders the whole scene into a depth target to capture the blob,
 * and its "render once" guard is a plain `let count` in the component body, so
 * it resets on every React render and the capture happens again and again. It
 * measured as a full extra scene pass at every tier: draw calls went 171 → 298
 * at `low`, which is the tier a contact shadow exists to help. A radial
 * gradient on a quad costs one draw call and no pass at all.
 */

let uninstall: () => void;

beforeAll(() => {
  uninstall = installCanvasMock();
});

afterAll(() => {
  uninstall();
});

describe('the contact shadow texture', () => {
  it('is a texture the scene can use', () => {
    const texture = createContactShadowTexture();

    expect(texture.image).toBeTruthy();
    // `needsUpdate` is a set-only accessor on a three texture; `version` is
    // what it increments, and what the renderer actually reads.
    expect(texture.version).toBeGreaterThan(0);
    texture.dispose();
  });

  // A power-of-two square: it is sampled with a mipmap chain like any other.
  it('is square, and a size the GPU likes', () => {
    const texture = createContactShadowTexture();
    const { width, height } = texture.image as { width: number; height: number };

    expect(width).toBe(height);
    expect(Math.log2(width) % 1).toBe(0);
    texture.dispose();
  });

  /**
   * Not clamped, and that matters: the default wrap is repeat, so the edge of
   * a fading gradient meets its own opposite edge and draws a seam across the
   * water where the quad ends.
   */
  it('stops at its edges rather than tiling', () => {
    const texture = createContactShadowTexture();

    expect(texture.wrapS).toBe(1001); // THREE.ClampToEdgeWrapping
    expect(texture.wrapT).toBe(1001);
    texture.dispose();
  });

  it('is a disc a boat’s length across, not a postage stamp', () => {
    // The hull is about 8 m; the blob has to reach under all of it.
    expect(CONTACT_SHADOW_RADIUS_M * 2).toBeGreaterThanOrEqual(8);
  });

  // A contact shadow is a suggestion of darkness, not a hole in the river.
  it('is faint enough to read as a shadow rather than as paint', () => {
    expect(CONTACT_SHADOW_OPACITY).toBeGreaterThan(0);
    expect(CONTACT_SHADOW_OPACITY).toBeLessThanOrEqual(0.5);
  });
});
