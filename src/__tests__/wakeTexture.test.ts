import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as THREE from 'three';
import { installCanvasMock } from './canvasMock';
import {
  WAKE_TEXTURE_SIZE,
  FOAM_RING_TEXTURE_SIZE,
  FOAM_RING_LIFETIME_SECONDS,
  WAKE_RENDER_ORDER,
  STERN_Z_METRES,
  BLOOM_SAFE_LUMINANCE,
  WAKE_ALPHA_STOPS,
  WAKE_EDGE_KEEP_STOPS,
  wakeFor,
  foamRingFor,
  foamLuminance,
  bloomSafeFoamColor,
  createWakeTexture,
  createFoamRingTexture,
  createWakeGeometry,
} from '../components/rower3d/wakeTexture';

/**
 * Issue #323 — the wake and the blade foam were white slabs.
 *
 * Three untextured quads at `color="white"`, bright enough for the bloom pass
 * to find them, with hard edges, no fade behind the stern, and — the part that
 * made it a slab rather than a wake — drawn from the boat's centre backwards,
 * so the whole thing sat under the hull instead of behind it.
 */

/** The hull is an 8 m box centred on the origin; its stern cone ends at z = -4.4. */
const HULL_STERN_Z = -4.4;

describe('wakeFor', () => {
  it('draws nothing at rest', () => {
    expect(wakeFor(0)).toEqual({ length: 0, opacity: 0 });
  });

  it('is a soft trail at racing pace, not a lamp', () => {
    const wake = wakeFor(4.17);
    expect(wake.length).toBeCloseTo(9.17, 2);
    expect(wake.opacity).toBeCloseTo(0.51, 2);
    // The Gherkin's ceiling: the wake never reaches an opacity that reads as white.
    expect(wake.opacity).toBeLessThan(0.6);
  });

  it('grows with speed', () => {
    expect(wakeFor(3).length).toBeGreaterThan(wakeFor(2).length);
    expect(wakeFor(3).opacity).toBeGreaterThan(wakeFor(2).opacity);
  });

  it('stops growing rather than running off down the river', () => {
    expect(wakeFor(50).length).toBe(14);
    expect(wakeFor(50).opacity).toBeCloseTo(0.55, 5);
  });

  it('treats a boat going backwards as a boat at rest', () => {
    expect(wakeFor(-3)).toEqual({ length: 0, opacity: 0 });
  });
});

describe('foamRingFor', () => {
  it('starts small and bright at the catch', () => {
    const ring = foamRingFor(1);
    expect(ring.scale).toBeCloseTo(0.4, 5);
    expect(ring.opacity).toBeCloseTo(0.7, 5);
  });

  it('ends wide and gone', () => {
    const ring = foamRingFor(0);
    expect(ring.scale).toBeCloseTo(1.4, 5);
    expect(ring.opacity).toBe(0);
  });

  it('expands as it fades', () => {
    const half = foamRingFor(0.5);
    expect(half.scale).toBeCloseTo(0.9, 5);
    expect(half.opacity).toBeCloseTo(0.35, 5);
  });

  it('holds its bounds when the life runs past either end', () => {
    expect(foamRingFor(2)).toEqual(foamRingFor(1));
    expect(foamRingFor(-1)).toEqual(foamRingFor(0));
  });

  it('takes six tenths of a second to do it', () => {
    expect(FOAM_RING_LIFETIME_SECONDS).toBe(0.6);
  });
});

describe('the foam colour', () => {
  it('leaves a colour the bloom pass would already ignore alone', () => {
    const dim = '#8090a0';
    expect(foamLuminance(dim)).toBeLessThan(BLOOM_SAFE_LUMINANCE);
    expect(bloomSafeFoamColor(dim)).toBe(dim);
  });

  it('dims white to the ceiling rather than letting the bloom find it', () => {
    expect(foamLuminance('#ffffff')).toBeCloseTo(1, 5);
    expect(foamLuminance(bloomSafeFoamColor('#ffffff'))).toBeLessThanOrEqual(
      BLOOM_SAFE_LUMINANCE,
    );
  });

  it('keeps the hue while it dims', () => {
    const dimmed = bloomSafeFoamColor('#dfe9ee');
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(dimmed.slice(i, i + 2), 16));
    expect(g).toBeGreaterThan(r);
    expect(b).toBeGreaterThan(g);
  });

  it('reads an unparseable colour as black rather than as white', () => {
    // The wrong direction to fail in matters here: a colour the parser cannot
    // read must not come back bright enough for the bloom pass to find.
    expect(foamLuminance('rebeccapurple')).toBe(0);
    expect(bloomSafeFoamColor('rebeccapurple')).toBe('rebeccapurple');
  });

  it('sits below the bloom threshold, which is where a wake belongs', () => {
    // #327 raised the bloom's luminanceThreshold to 0.9; the ceiling is under it.
    expect(BLOOM_SAFE_LUMINANCE).toBeLessThan(0.9);
  });
});

describe('the wake texture', () => {
  it('fades along the wake, opaque at the stern and gone at the tail', () => {
    expect(WAKE_ALPHA_STOPS[0].offset).toBe(0);
    expect(WAKE_ALPHA_STOPS[0].alpha).toBeGreaterThan(0.5);
    const last = WAKE_ALPHA_STOPS[WAKE_ALPHA_STOPS.length - 1];
    expect(last.offset).toBe(1);
    expect(last.alpha).toBe(0);

    for (let i = 1; i < WAKE_ALPHA_STOPS.length; i += 1) {
      expect(WAKE_ALPHA_STOPS[i].offset).toBeGreaterThan(WAKE_ALPHA_STOPS[i - 1].offset);
      expect(WAKE_ALPHA_STOPS[i].alpha).toBeLessThan(WAKE_ALPHA_STOPS[i - 1].alpha);
    }
  });

  it('softens both sides so the wake has no cut edge', () => {
    const at = (offset: number) =>
      WAKE_EDGE_KEEP_STOPS.find((stop) => stop.offset === offset)?.alpha;

    expect(at(0), 'the left edge is a hard line').toBe(0);
    expect(at(1), 'the right edge is a hard line').toBe(0);
    expect(at(0.5)).toBe(1);
  });

  it('returns nothing rather than throwing where there is no context to draw in', () => {
    expect(() => createWakeTexture()).not.toThrow();
    expect(createWakeTexture()).toBeNull();
    expect(createFoamRingTexture()).toBeNull();
  });

  describe('with a canvas to draw into', () => {
    let uninstall: () => void;
    beforeAll(() => {
      uninstall = installCanvasMock();
    });
    afterAll(() => uninstall());

    it('is a square of the documented size, in the colour space the scene renders in', () => {
      const texture = createWakeTexture();
      expect(texture, 'no texture was produced').not.toBeNull();
      expect(texture!.image.width).toBe(WAKE_TEXTURE_SIZE);
      expect(texture!.image.height).toBe(WAKE_TEXTURE_SIZE);
      expect(texture!.colorSpace).toBe(THREE.SRGBColorSpace);
    });

    it('is not flipped, so the opaque end of the gradient is the stern end', () => {
      // uv.y runs 0 at the stern to 1 at the tail, and the gradient is drawn
      // the same way round. three flips canvas textures by default, which
      // would put the fade on backwards: a wake brightest where it ends.
      expect(createWakeTexture()!.flipY).toBe(false);
    });

    it('gives the foam ring a texture of its own', () => {
      const texture = createFoamRingTexture();
      expect(texture!.image.width).toBe(FOAM_RING_TEXTURE_SIZE);
      expect(texture!.image.height).toBe(FOAM_RING_TEXTURE_SIZE);
    });
  });
});

describe('the wake geometry', () => {
  const verticesOf = (geometry: THREE.BufferGeometry) => {
    const position = geometry.getAttribute('position') as THREE.BufferAttribute;
    return Array.from({ length: position.count }, (_, i) => ({
      x: position.getX(i),
      y: position.getY(i),
      z: position.getZ(i),
    }));
  };

  it('trails backwards over a unit length, so speed can scale it', () => {
    const vertices = verticesOf(createWakeGeometry());
    expect(vertices.length, 'no wake was built').toBeGreaterThan(0);

    for (const vertex of vertices) {
      expect(vertex.z).toBeLessThanOrEqual(0);
      expect(vertex.z).toBeGreaterThanOrEqual(-1);
    }
    expect(Math.min(...vertices.map((v) => v.z))).toBeCloseTo(-1, 5);
  });

  it('is one mesh, carrying both arms of the V and the stern patch', () => {
    const vertices = verticesOf(createWakeGeometry());
    expect(Math.min(...vertices.map((v) => v.x)), 'no left arm').toBeLessThan(-0.1);
    expect(Math.max(...vertices.map((v) => v.x)), 'no right arm').toBeGreaterThan(0.1);
  });

  it('never reaches under the hull, at any speed', () => {
    const vertices = verticesOf(createWakeGeometry());

    for (const velocity of [0.5, 2, 4.17, 50]) {
      const { length } = wakeFor(velocity);
      const nearest = Math.max(...vertices.map((v) => STERN_Z_METRES + v.z * length));
      expect(
        nearest,
        'the wake is drawn under the boat instead of behind it at ' + velocity + ' m/s',
      ).toBeLessThanOrEqual(HULL_STERN_Z);
    }
  });

  it('runs its texture along the wake and across it', () => {
    const uv = createWakeGeometry().getAttribute('uv') as THREE.BufferAttribute;
    const vs = Array.from({ length: uv.count }, (_, i) => uv.getY(i));
    const us = Array.from({ length: uv.count }, (_, i) => uv.getX(i));

    expect(Math.min(...vs)).toBe(0);
    expect(Math.max(...vs)).toBe(1);
    expect(Math.min(...us)).toBe(0);
    expect(Math.max(...us)).toBe(1);
  });

  it('carries a bounding sphere so the frame loop can cull it', () => {
    expect(createWakeGeometry().boundingSphere).not.toBeNull();
  });

  it('draws over the water rather than fighting it for the depth buffer', () => {
    expect(WAKE_RENDER_ORDER).toBe(2);
  });
});
