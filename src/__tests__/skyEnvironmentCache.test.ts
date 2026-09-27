import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as THREE from 'three';
import { SCENE_CONFIG } from '../components/rower3d/themeConfig';
import {
  acquireSkyEnvironment,
  buildCountForTesting,
  resetSkyEnvironmentCacheForTesting,
} from '../components/rower3d/skyEnvironmentCache';
import * as skyEnvironment from '../components/rower3d/skyEnvironment';

/**
 * Issue #418 — the sky PMREM is built once per (sky, sun) and shared between
 * the water and the scene environment.
 */

const rendererStub = () => ({} as unknown as THREE.WebGLRenderer);

const fakeTexture = (name: string): THREE.Texture => {
  const t = new THREE.Texture();
  t.name = name;
  return t;
};

const SUN: [number, number, number] = [90, 55, 35];

beforeEach(() => resetSkyEnvironmentCacheForTesting());

describe('acquireSkyEnvironment', () => {
  it('builds once for two consumers asking with the same sky (AC1.1, AC1.2)', () => {
    const build = vi.spyOn(skyEnvironment, 'buildSkyEnvironment')
      .mockImplementation(() => fakeTexture('midday'));

    const water = acquireSkyEnvironment(rendererStub(), SCENE_CONFIG.sky, SUN);
    const scene = acquireSkyEnvironment(rendererStub(), SCENE_CONFIG.sky, SUN);

    expect(build).toHaveBeenCalledTimes(1);
    expect(water.texture).toBe(scene.texture);
    expect(buildCountForTesting()).toBe(1);
  });

  it('builds again for a different sky (AC2.1)', () => {
    const build = vi.spyOn(skyEnvironment, 'buildSkyEnvironment')
      .mockImplementation((_, __, sun: readonly [number, number, number]) => fakeTexture(sun.join(',')));

    const midday = acquireSkyEnvironment(rendererStub(), SCENE_CONFIG.sky, SUN);
    const dusk = acquireSkyEnvironment(rendererStub(), SCENE_CONFIG.sky, [10, 5, 30]);

    expect(build).toHaveBeenCalledTimes(2);
    expect(midday.texture).not.toBe(dusk.texture);
  });

  it('disposes only after the last consumer releases (AC1.4)', () => {
    const texture = fakeTexture('shared');
    const dispose = vi.spyOn(texture, 'dispose');
    vi.spyOn(skyEnvironment, 'buildSkyEnvironment').mockReturnValueOnce(texture);

    const water = acquireSkyEnvironment(rendererStub(), SCENE_CONFIG.sky, SUN);
    const scene = acquireSkyEnvironment(rendererStub(), SCENE_CONFIG.sky, SUN);

    water.release();
    expect(dispose).not.toHaveBeenCalled();

    scene.release();
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('a rebuild after the last release hands back a fresh texture (AC1.3)', () => {
    const first = fakeTexture('first');
    const second = fakeTexture('second');
    const dispose = vi.spyOn(first, 'dispose');
    vi.spyOn(skyEnvironment, 'buildSkyEnvironment')
      .mockReturnValueOnce(first)
      .mockReturnValueOnce(second);

    acquireSkyEnvironment(rendererStub(), SCENE_CONFIG.sky, SUN).release();
    expect(dispose).toHaveBeenCalledTimes(1);

    const again = acquireSkyEnvironment(rendererStub(), SCENE_CONFIG.sky, SUN);
    expect(again.texture).toBe(second);
    expect(buildCountForTesting()).toBe(2);
  });

  it('releasing twice from the same handle is a no-op (AC1.4)', () => {
    const texture = fakeTexture('once');
    const dispose = vi.spyOn(texture, 'dispose');
    vi.spyOn(skyEnvironment, 'buildSkyEnvironment').mockReturnValueOnce(texture);

    const water = acquireSkyEnvironment(rendererStub(), SCENE_CONFIG.sky, SUN);
    const scene = acquireSkyEnvironment(rendererStub(), SCENE_CONFIG.sky, SUN);

    water.release();
    water.release();
    expect(dispose).not.toHaveBeenCalled();

    scene.release();
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('returns a null-texture handle where the renderer cannot convolve one', () => {
    vi.spyOn(skyEnvironment, 'buildSkyEnvironment').mockReturnValueOnce(null);
    const handle = acquireSkyEnvironment(rendererStub(), SCENE_CONFIG.sky, SUN);
    expect(handle.texture).toBeNull();
    // Releasing a null handle does not throw and does not count.
    expect(() => handle.release()).not.toThrow();
  });

  it('stops growing across a session (AC2.2)', () => {
    vi.spyOn(skyEnvironment, 'buildSkyEnvironment').mockImplementation(() => fakeTexture(''));

    const handles = [];
    for (let i = 0; i < 5; i++) {
      handles.push(acquireSkyEnvironment(rendererStub(), SCENE_CONFIG.sky, [i, 0, 0]));
    }
    handles.forEach((h) => h.release());

    // Every unique sky was built once; nothing lingers keyed on identity.
    expect(buildCountForTesting()).toBe(5);
  });
});
