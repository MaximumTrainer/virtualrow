import { describe, it, expect } from 'vitest';
import { resolveSceneQuality } from '../components/rower3d/sceneQuality';

/** An Intel integrated GPU, as reported through ANGLE on Windows. */
const INTEGRATED = {
  maxTextureSize: 16384,
  renderer: 'ANGLE (Intel, Intel(R) UHD Graphics (0x00009BC4) Direct3D11 vs_5_0 ps_5_0)',
};

const DISCRETE = {
  maxTextureSize: 16384,
  renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 2070 with Max-Q Design Direct3D11 vs_5_0 ps_5_0)',
};

describe('resolveSceneQuality', () => {
  it('reads auto as low on an integrated GPU, before the canvas is built', () => {
    // The whole point: the canvas used to treat 'auto' as high quality and turn
    // on shadows, MSAA and dpr 2, while the scene inside resolved to low.
    expect(resolveSceneQuality({ requested: 'auto', capabilities: INTEGRATED })).toBe('low');
  });

  it('leaves capable hardware alone', () => {
    expect(resolveSceneQuality({ requested: 'auto', capabilities: DISCRETE })).not.toBe('low');
  });

  it('obeys a mode the rower chose', () => {
    expect(resolveSceneQuality({ requested: 'high', capabilities: INTEGRATED })).toBe('high');
    expect(resolveSceneQuality({ requested: 'low', capabilities: DISCRETE })).toBe('low');
  });

  it('obeys a mode a test pinned, whatever the hardware says', () => {
    expect(
      resolveSceneQuality({ requested: 'auto', capabilities: INTEGRATED, explicit: true }),
    ).toBe('auto');
  });

  it('does not guess when the probe learned nothing', () => {
    // No capabilities means no evidence; treat it as the caller asked rather
    // than inventing a downgrade.
    expect(resolveSceneQuality({ requested: 'auto', capabilities: {} })).toBe('auto');
    expect(resolveSceneQuality({ requested: 'auto', capabilities: null })).toBe('auto');
  });

  it('drops to low when the GPU cannot hold a large texture', () => {
    expect(
      resolveSceneQuality({
        requested: 'auto',
        capabilities: { maxTextureSize: 2048, renderer: DISCRETE.renderer },
      }),
    ).toBe('low');
  });
});
