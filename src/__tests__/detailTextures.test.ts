import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import * as THREE from 'three';
import { installCanvasMock } from './canvasMock';
import {
  brickNormalMap,
  carbonWeaveNormalMap,
  clapboardNormalMap,
  lycraKnitNormalMap,
  plasterNormalMap,
  resetDetailTexturesForTesting,
} from '../components/rower3d/detailTextures';

let teardownCanvas: (() => void) | null = null;
beforeAll(() => { teardownCanvas = installCanvasMock(); });
afterAll(() => { teardownCanvas?.(); });
beforeEach(() => resetDetailTexturesForTesting());

describe('detail textures (#354)', () => {
  it('a carbon weave normal map returns a CanvasTexture set to repeat', () => {
    const t = carbonWeaveNormalMap();
    expect(t).toBeInstanceOf(THREE.CanvasTexture);
    expect(t!.wrapS).toBe(THREE.RepeatWrapping);
    expect(t!.wrapT).toBe(THREE.RepeatWrapping);
    t!.dispose();
  });

  it('a lycra knit normal map returns a CanvasTexture set to repeat', () => {
    const t = lycraKnitNormalMap();
    expect(t).toBeInstanceOf(THREE.CanvasTexture);
    expect(t!.wrapS).toBe(THREE.RepeatWrapping);
    expect(t!.wrapT).toBe(THREE.RepeatWrapping);
    t!.dispose();
  });

  it('the same texture kind is cached and returns the same object twice', () => {
    // Fresh canvas each call would burn megabytes on every scull mount.
    // Callers get a shared instance and share its lifetime.
    const a = carbonWeaveNormalMap();
    const b = carbonWeaveNormalMap();
    expect(a).toBe(b);
  });
});

describe('facade detail textures (#432)', () => {
  for (const [name, build] of [
    ['brick', brickNormalMap],
    ['plaster', plasterNormalMap],
    ['clapboard', clapboardNormalMap],
  ] as const) {
    it(`${name} is a CanvasTexture set to repeat, cached across calls`, () => {
      const a = build();
      const b = build();
      expect(a).toBeInstanceOf(THREE.CanvasTexture);
      expect(a!.wrapS).toBe(THREE.RepeatWrapping);
      expect(a!.wrapT).toBe(THREE.RepeatWrapping);
      expect(a).toBe(b);
    });
  }

  it('the three facade kinds are three distinct textures', () => {
    const b = brickNormalMap();
    const p = plasterNormalMap();
    const c = clapboardNormalMap();
    expect(b).not.toBe(p);
    expect(p).not.toBe(c);
    expect(b).not.toBe(c);
  });
});
