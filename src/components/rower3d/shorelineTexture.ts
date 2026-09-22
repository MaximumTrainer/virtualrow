import * as THREE from 'three';

// ============================================================================
// THE FOAM LINE (#334)
//
// The water met the bank at a hard seam: two surfaces of different colours
// butted together, with nothing where a real river has wet stone, weed and a
// line of foam. This is the gradient drawn across the shoreline strip —
// white and opaque at the waterline, sand a little way up, and gone by the
// dry end so the strip fades into the bank instead of ending at it.
//
// Generated rather than shipped, like the bank's own mottle: it is one column
// of pixels' worth of information, and the route already fetches a hundred and
// thirty models.
// ============================================================================

/** Texture height, in pixels. The gradient runs across `uv.x`, so this is the long axis. */
export const SHORELINE_TEXTURE_SIZE = 64;

/**
 * A wet-to-dry gradient, left to right.
 *
 * Returns null where there is no 2D context to draw into — the scene falls
 * back to no foam rather than to a crash, which is the right failure for
 * decoration.
 */
export const createShorelineTexture = (): THREE.CanvasTexture | null => {
  const canvas = document.createElement('canvas');
  canvas.width = SHORELINE_TEXTURE_SIZE;
  canvas.height = 1;

  const context = canvas.getContext('2d');
  if (!context) return null;

  const gradient = context.createLinearGradient(0, 0, SHORELINE_TEXTURE_SIZE, 0);
  // Foam at the waterline, thinning fast: a foam line is a line, not a band.
  gradient.addColorStop(0, 'rgba(255, 255, 255, 0.85)');
  gradient.addColorStop(0.25, 'rgba(240, 244, 238, 0.45)');
  // Wet sand, which is the bank a shade darker rather than a colour of its own.
  gradient.addColorStop(0.55, 'rgba(150, 140, 110, 0.35)');
  gradient.addColorStop(1, 'rgba(150, 140, 110, 0)');

  context.fillStyle = gradient;
  context.fillRect(0, 0, SHORELINE_TEXTURE_SIZE, 1);

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  return texture;
};
