import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { createPostFx, postFxBytes, DEFAULT_POSTFX_CAPS, BLOOM_MIP_LEVELS } from '../postFx';
import { installGPUStub, makeMockAdapter, makeMockGPU, makeMockDevice } from '../../__tests__/_mockWebGPU';

beforeEach(() => {
  installGPUStub(makeMockGPU(makeMockAdapter()));
});

afterEach(() => {
  installGPUStub(undefined);
});

const makeViewRef = () => ({} as GPUTextureView);
const makeTextureRef = () => ({ destroy: () => undefined } as unknown as GPUTexture);

describe('createPostFx', () => {
  it('builds the bloom pipelines once per caps', () => {
    const device = makeMockDevice();
    const handle = createPostFx({
      device,
      sceneFormat: 'rgba16float',
      outputFormat: 'bgra8unorm',
      caps: { ...DEFAULT_POSTFX_CAPS, ssao: true, dof: true },
    });
    handle.setInputs({
      sceneView: makeViewRef(),
      sceneTexture: makeTextureRef(),
      depthView: makeViewRef(),
      width: 320,
      height: 240,
    });
    const pipelines = device.__log.createdPipelines;
    // bloom-down, bloom-up, composite, ssao, dof.
    expect(pipelines).toContain('bloom-down');
    expect(pipelines).toContain('bloom-up');
    expect(pipelines).toContain('composite');
    expect(pipelines).toContain('ssao');
    expect(pipelines).toContain('dof');
    handle.dispose();
  });

  it('skips SSAO + DOF pipelines when caps say off', () => {
    const device = makeMockDevice();
    const handle = createPostFx({
      device,
      sceneFormat: 'rgba16float',
      outputFormat: 'bgra8unorm',
      caps: DEFAULT_POSTFX_CAPS, // ssao: false, dof: false
    });
    handle.setInputs({
      sceneView: makeViewRef(),
      sceneTexture: makeTextureRef(),
      depthView: makeViewRef(),
      width: 320,
      height: 240,
    });
    const pipelines = device.__log.createdPipelines;
    expect(pipelines).not.toContain('ssao');
    expect(pipelines).not.toContain('dof');
    handle.dispose();
  });

  // NFR7 — "GPU memory added by post ≤ 1.3× the current scene texture
  // budget on tier high". The scene texture budget is the HDR scene colour
  // (8 bytes/px); the post additions are the bloom pyramid + LUT + SSAO +
  // DOF intermediates. For 1920×1080 those additions come to ~0.46× scene,
  // comfortably inside the 1.3× bound.
  it('post memory budget stays within NFR7 (<= 1.3x scene colour on tier high)', () => {
    const w = 1920;
    const h = 1080;
    const sceneBytes = w * h * 8;
    const caps = { bloom: true, tone: true, vignette: true, lut: true, ssao: true, dof: false, chromaticAberration: true };
    const total = postFxBytes(w, h, caps);
    const addedOverScene = (total - sceneBytes) / sceneBytes;
    expect(addedOverScene).toBeLessThanOrEqual(1.3);
  });

  it('chromatic aberration is shader-only — no extra GPU-side textures (#574)', () => {
    // Turning CA on or off must not change postFxBytes; the shader costs
    // three samples per fragment but zero new intermediates.
    const w = 1280;
    const h = 720;
    const base = { bloom: true, tone: true, vignette: true, lut: true, ssao: true, dof: true };
    expect(postFxBytes(w, h, { ...base, chromaticAberration: false })).toBe(
      postFxBytes(w, h, { ...base, chromaticAberration: true }),
    );
  });

  it('still creates the composite pipeline when chromaticAberration is on (#574)', () => {
    const device = makeMockDevice();
    const handle = createPostFx({
      device,
      sceneFormat: 'rgba16float',
      outputFormat: 'bgra8unorm',
      caps: { ...DEFAULT_POSTFX_CAPS, chromaticAberration: true },
    });
    handle.setInputs({
      sceneView: makeViewRef(),
      sceneTexture: makeTextureRef(),
      depthView: makeViewRef(),
      width: 320,
      height: 240,
    });
    expect(device.__log.createdPipelines).toContain('composite');
    handle.dispose();
  });

  it('bloom pyramid is BLOOM_MIP_LEVELS mips', () => {
    expect(BLOOM_MIP_LEVELS).toBeGreaterThanOrEqual(4);
    expect(BLOOM_MIP_LEVELS).toBeLessThanOrEqual(8);
  });
});
