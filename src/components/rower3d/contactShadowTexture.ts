import * as THREE from 'three';

/**
 * The shadow where the hull meets the water (issue #352).
 *
 * Without one the boat sits *on* the river rather than *in* it, however good
 * the directional shadow is — and on the `low` tier, which casts none at all,
 * it is the only thing joining the two.
 *
 * Drawn as one textured quad rather than with drei's `ContactShadows`. That
 * component renders the whole scene into a depth target to capture its blob,
 * and its "render once" guard is a plain `let count` in the component body, so
 * it resets on every React render and the capture runs again. Measured on the
 * same CI runner it cost a full extra scene pass at every tier — draw calls
 * went 171 → 298 at `low`, 336 → 684 at `high` — which is why every render
 * budget failed. The issue asks for a *cheap* contact shadow; a radial
 * gradient on a quad is one draw call and no pass at all.
 */

/** Texture edge in texels. Small: it is a blurred blob, not a photograph. */
const TEXTURE_SIZE = 128;

/** Half the disc's width in metres. The hull is about 8 m, so it reaches it. */
export const CONTACT_SHADOW_RADIUS_M = 5;

/** A suggestion of darkness under the hull, not a hole in the river. */
export const CONTACT_SHADOW_OPACITY = 0.35;

/**
 * A radial falloff, opaque at the centre and gone at the rim.
 *
 * Squared rather than linear, so the darkness sits under the hull instead of
 * spreading evenly to the edge of the quad and ending in a visible circle.
 */
export const createContactShadowTexture = (): THREE.Texture => {
  const canvas = document.createElement('canvas');
  canvas.width = TEXTURE_SIZE;
  canvas.height = TEXTURE_SIZE;

  const context = canvas.getContext('2d');
  const half = TEXTURE_SIZE / 2;

  if (context) {
    const gradient = context.createRadialGradient(half, half, 0, half, half, half);
    for (let stop = 0; stop <= 8; stop += 1) {
      const t = stop / 8;
      gradient.addColorStop(t, `rgba(0, 0, 0, ${(1 - t) ** 2})`);
    }
    context.fillStyle = gradient;
    context.fillRect(0, 0, TEXTURE_SIZE, TEXTURE_SIZE);
  }

  const texture = new THREE.CanvasTexture(canvas);
  // The default is repeat, and a fading gradient that meets its own opposite
  // edge draws a seam across the water at the rim of the quad.
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return texture;
};
