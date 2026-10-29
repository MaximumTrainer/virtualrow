/**
 * P8 of #542 — the post-processing stack. Orchestrated as a single `Pass`
 * that the top-level `frameGraph` appends after everything else; internally
 * the chain is fixed-order per D9-a:
 *
 *   bloom down (level 0 → N-1, bright-pass at level 0)
 *     → bloom up (level N-1 → 0, additive)
 *     → SSAO (if enabled)
 *     → composite (scene + bloom + LUT + vignette + ACES → swap-chain)
 *     → DOF (if enabled; reads the swap-chain output of composite via a copy)
 *
 * Writes to `ctx.outputView` (the real swap-chain). Reads the HDR scene
 * target via a sampler. On resize the engine calls `setInputs(…)` with the
 * new scene / depth views + dimensions; everything bloom-side is recreated.
 */

/// <reference types="@webgpu/types" />

import type { FrameContext, Pass } from './frameGraph';
import bloomDownWgsl from '../passes/bloomDown.wgsl?raw';
import bloomUpWgsl from '../passes/bloomUp.wgsl?raw';
import compositeWgsl from '../passes/composite.wgsl?raw';
import ssaoWgsl from '../passes/ssao.wgsl?raw';
import dofWgsl from '../passes/dofBlur.wgsl?raw';
import { buildNeutralLutPixels } from './postFxMath';

export interface PostFxCaps {
  bloom: boolean;
  tone: boolean;
  vignette: boolean;
  lut: boolean;
  ssao: boolean;
  dof: boolean;
  /** #574 — subtle radial chromatic aberration in the composite pass.
   *  Off below `high`; the shader uses a hard-coded offset of ~0.0035 UV
   *  (0.35% of the frame) which reads as a lens feel. */
  chromaticAberration: boolean;
}

export const DEFAULT_POSTFX_CAPS: PostFxCaps = {
  bloom: true,
  tone: true,
  vignette: true,
  lut: true,
  ssao: false,
  dof: false,
  chromaticAberration: false,
};

export interface PostFxOptions {
  device: GPUDevice;
  sceneFormat: GPUTextureFormat;
  outputFormat: GPUTextureFormat;
  caps: PostFxCaps;
  bloomMipLevels?: number;
  bloomStrength?: number;
  vignetteStrength?: number;
}

export interface PostFxInputs {
  sceneView: GPUTextureView;
  sceneTexture: GPUTexture;
  depthView: GPUTextureView;
  width: number;
  height: number;
}

export interface PostFxHandle {
  pass: Pass;
  setInputs(inputs: PostFxInputs): void;
  dispose(): void;
  /** For testing: counts of sub-passes recorded on the most recent frame. */
  readonly stats: { encoded: number; mipsEncoded: number };
}

const BLOOM_MIPS_DEFAULT = 6;

export const createPostFx = (opts: PostFxOptions): PostFxHandle => {
  const { device, sceneFormat, outputFormat, caps } = opts;
  const bloomMipLevels = Math.max(2, opts.bloomMipLevels ?? BLOOM_MIPS_DEFAULT);
  const bloomStrength = opts.bloomStrength ?? 0.08;
  const vignetteStrength = opts.vignetteStrength ?? 0.4;

  // Shared full-screen sampler.
  const linearSampler = device.createSampler({
    label: 'postfx-linear',
    magFilter: 'linear',
    minFilter: 'linear',
    addressModeU: 'clamp-to-edge',
    addressModeV: 'clamp-to-edge',
  });
  const depthSampler = device.createSampler({ label: 'postfx-depth', magFilter: 'nearest', minFilter: 'nearest' });

  // --- Bloom pipelines (reused across mips) ---
  const bloomDownModule = device.createShaderModule({ label: 'bloom-down', code: bloomDownWgsl });
  const bloomDownPipeline = device.createRenderPipeline({
    label: 'bloom-down',
    layout: 'auto',
    vertex: { module: bloomDownModule, entryPoint: 'vs_main' },
    fragment: { module: bloomDownModule, entryPoint: 'fs_main', targets: [{ format: sceneFormat }] },
    primitive: { topology: 'triangle-list' },
  });
  const bloomUpModule = device.createShaderModule({ label: 'bloom-up', code: bloomUpWgsl });
  const bloomUpPipeline = device.createRenderPipeline({
    label: 'bloom-up',
    layout: 'auto',
    vertex: { module: bloomUpModule, entryPoint: 'vs_main' },
    fragment: {
      module: bloomUpModule,
      entryPoint: 'fs_main',
      targets: [
        {
          format: sceneFormat,
          blend: {
            color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
            alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
          },
        },
      ],
    },
    primitive: { topology: 'triangle-list' },
  });

  // Bloom uniforms: single buffer re-written per level.
  const bloomDownUniforms = device.createBuffer({
    label: 'bloom-down-u',
    size: 16,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const bloomUpUniforms = device.createBuffer({
    label: 'bloom-up-u',
    size: 16,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  // --- Composite pipeline ---
  const compositeModule = device.createShaderModule({ label: 'composite', code: compositeWgsl });
  const compositePipeline = device.createRenderPipeline({
    label: 'composite',
    layout: 'auto',
    vertex: { module: compositeModule, entryPoint: 'vs_main' },
    fragment: { module: compositeModule, entryPoint: 'fs_main', targets: [{ format: outputFormat }] },
    primitive: { topology: 'triangle-list' },
  });
  // 32-byte uniform block = vec4<f32> (bloom/vignette/lutSize/aoEnabled) +
  // vec4<f32> (caOffset + 3 pads). WGSL requires the struct size to be a
  // multiple of its biggest member's alignment, so the pads stay. #574.
  const compositeUniforms = device.createBuffer({
    label: 'composite-u',
    size: 32,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const compositeScratch = new Float32Array(8);
  compositeScratch[0] = bloomStrength;
  compositeScratch[1] = vignetteStrength;
  compositeScratch[2] = 32; // LUT size
  compositeScratch[3] = caps.ssao ? 1 : 0;
  // Radial CA offset in UV units at the frame corner. 0.0035 = ~3.5 px on a
  // 1000-px-wide canvas; subtle, reads as lens feel, never as a defect.
  compositeScratch[4] = caps.chromaticAberration ? 0.0035 : 0;
  compositeScratch[5] = 0;
  compositeScratch[6] = 0;
  compositeScratch[7] = 0;
  device.queue.writeBuffer(compositeUniforms, 0, compositeScratch as BufferSource);

  // --- SSAO ---
  const ssaoModule = caps.ssao ? device.createShaderModule({ label: 'ssao', code: ssaoWgsl }) : null;
  const ssaoPipeline =
    ssaoModule
      ? device.createRenderPipeline({
          label: 'ssao',
          layout: 'auto',
          vertex: { module: ssaoModule, entryPoint: 'vs_main' },
          fragment: { module: ssaoModule, entryPoint: 'fs_main', targets: [{ format: 'r8unorm' }] },
          primitive: { topology: 'triangle-list' },
        })
      : null;
  const ssaoUniforms = ssaoPipeline
    ? device.createBuffer({ label: 'ssao-u', size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
    : null;
  if (ssaoUniforms) {
    const b = new Float32Array(4);
    b[0] = 0.01; // radiusUV
    b[1] = 4.0; // strength
    device.queue.writeBuffer(ssaoUniforms, 0, b as BufferSource);
  }

  // --- DOF ---
  const dofModule = caps.dof ? device.createShaderModule({ label: 'dof', code: dofWgsl }) : null;
  const dofPipeline =
    dofModule
      ? device.createRenderPipeline({
          label: 'dof',
          layout: 'auto',
          vertex: { module: dofModule, entryPoint: 'vs_main' },
          fragment: { module: dofModule, entryPoint: 'fs_main', targets: [{ format: outputFormat }] },
          primitive: { topology: 'triangle-list' },
        })
      : null;
  const dofUniforms = dofPipeline
    ? device.createBuffer({ label: 'dof-u', size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
    : null;
  if (dofUniforms) {
    const b = new Float32Array(4);
    b[0] = 0.995; // focusDepth (nonlinear z) — far-focus by default
    b[1] = 0.004; // focusRange
    b[2] = 2.0; // blurRadius (px)
    device.queue.writeBuffer(dofUniforms, 0, b as BufferSource);
  }

  // --- Neutral LUT texture (D4-a). Shipped as a 1024×32 PNG that the host
  // uploads via `uploadFromImageBitmap`, but we fall back to an in-memory
  // identity LUT if the caller doesn't supply one (so unit tests + the smoke
  // page don't need an asset fetch). ---
  const lutTexture = device.createTexture({
    label: 'postfx-lut',
    size: { width: 32 * 32, height: 32 },
    format: 'rgba8unorm',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
  });
  const neutralPixels = buildNeutralLutPixels(32);
  device.queue.writeTexture?.(
    { texture: lutTexture },
    neutralPixels as BufferSource,
    { bytesPerRow: 32 * 32 * 4 },
    { width: 32 * 32, height: 32 },
  );
  const lutView = lutTexture.createView();

  // Mutable state: bloom mips, SSAO target, DOF scratch, bind groups.
  let bloomMips: Array<{ texture: GPUTexture; view: GPUTextureView; width: number; height: number }> = [];
  let ssaoTarget: EngineTargetTex | null = null;
  let dofTarget: EngineTargetTex | null = null;
  let currentInputs: PostFxInputs | null = null;
  const stats = { encoded: 0, mipsEncoded: 0 };
  let disposed = false;

  const destroyMips = (): void => {
    for (const m of bloomMips) m.texture.destroy();
    bloomMips = [];
    ssaoTarget?.destroy();
    ssaoTarget = null;
    dofTarget?.destroy();
    dofTarget = null;
  };

  const setInputs = (inputs: PostFxInputs): void => {
    if (disposed) return;
    currentInputs = inputs;
    destroyMips();
    let w = Math.max(2, inputs.width);
    let h = Math.max(2, inputs.height);
    for (let i = 0; i < bloomMipLevels; i += 1) {
      w = Math.max(1, Math.floor(w / 2));
      h = Math.max(1, Math.floor(h / 2));
      const tex = device.createTexture({
        label: `bloom-mip-${i}`,
        size: { width: w, height: h },
        format: sceneFormat,
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
      });
      bloomMips.push({ texture: tex, view: tex.createView(), width: w, height: h });
    }
    if (caps.ssao) {
      ssaoTarget = createTarget(device, 'postfx-ssao', inputs.width, inputs.height, 'r8unorm');
    }
    if (caps.dof) {
      dofTarget = createTarget(device, 'postfx-dof-copy', inputs.width, inputs.height, outputFormat);
    }
  };

  const buildDownBind = (src: GPUTextureView): GPUBindGroup =>
    device.createBindGroup({
      layout: bloomDownPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: src },
        { binding: 1, resource: linearSampler },
        { binding: 2, resource: { buffer: bloomDownUniforms } },
      ],
    });

  const buildUpBind = (src: GPUTextureView): GPUBindGroup =>
    device.createBindGroup({
      layout: bloomUpPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: src },
        { binding: 1, resource: linearSampler },
        { binding: 2, resource: { buffer: bloomUpUniforms } },
      ],
    });

  const writeDownUniforms = (bright: boolean): void => {
    const b = new Float32Array(4);
    b[0] = bright ? 1 : 0;
    b[1] = 1.0; // threshold
    b[2] = 0.5; // knee
    device.queue.writeBuffer(bloomDownUniforms, 0, b as BufferSource);
  };

  const writeUpUniforms = (strength: number): void => {
    const b = new Float32Array(4);
    b[0] = strength;
    device.queue.writeBuffer(bloomUpUniforms, 0, b as BufferSource);
  };

  const encode = (ctx: FrameContext): void => {
    if (disposed || !currentInputs) return;
    stats.encoded = 0;
    stats.mipsEncoded = 0;

    const { encoder } = ctx;

    if (caps.bloom && bloomMips.length > 0) {
      // Down pyramid: mip[0] uses the scene (bright-pass); subsequent use the previous mip.
      writeDownUniforms(true);
      {
        const dstMip = bloomMips[0];
        const bind = buildDownBind(currentInputs.sceneView);
        const pass = encoder.beginRenderPass({
          label: 'bloom-down-0',
          colorAttachments: [
            { view: dstMip.view, loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 0 } },
          ],
        });
        pass.setPipeline(bloomDownPipeline);
        pass.setBindGroup(0, bind);
        pass.draw(3);
        pass.end();
        stats.mipsEncoded += 1;
      }
      writeDownUniforms(false);
      for (let i = 1; i < bloomMips.length; i += 1) {
        const bind = buildDownBind(bloomMips[i - 1].view);
        const pass = encoder.beginRenderPass({
          label: `bloom-down-${i}`,
          colorAttachments: [
            { view: bloomMips[i].view, loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 0 } },
          ],
        });
        pass.setPipeline(bloomDownPipeline);
        pass.setBindGroup(0, bind);
        pass.draw(3);
        pass.end();
        stats.mipsEncoded += 1;
      }

      // Up pyramid: additive-blend each smaller mip into the next-larger mip.
      writeUpUniforms(1.0);
      for (let i = bloomMips.length - 1; i > 0; i -= 1) {
        const bind = buildUpBind(bloomMips[i].view);
        const pass = encoder.beginRenderPass({
          label: `bloom-up-${i}`,
          colorAttachments: [{ view: bloomMips[i - 1].view, loadOp: 'load', storeOp: 'store' }],
        });
        pass.setPipeline(bloomUpPipeline);
        pass.setBindGroup(0, bind);
        pass.draw(3);
        pass.end();
      }
      stats.encoded += 1;
    }

    if (caps.ssao && ssaoPipeline && ssaoTarget && ssaoUniforms) {
      const bind = device.createBindGroup({
        layout: ssaoPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: currentInputs.depthView },
          { binding: 1, resource: depthSampler },
          { binding: 2, resource: { buffer: ssaoUniforms } },
        ],
      });
      const pass = encoder.beginRenderPass({
        label: 'ssao',
        colorAttachments: [{ view: ssaoTarget.view, loadOp: 'clear', storeOp: 'store', clearValue: { r: 1, g: 1, b: 1, a: 1 } }],
      });
      pass.setPipeline(ssaoPipeline);
      pass.setBindGroup(0, bind);
      pass.draw(3);
      pass.end();
      stats.encoded += 1;
    }

    // Composite. Reads scene + brightest bloom mip (level 0) + LUT + AO.
    {
      const bloomView = caps.bloom && bloomMips.length > 0 ? bloomMips[0].view : currentInputs.sceneView;
      const aoView = ssaoTarget?.view ?? lutView; // reuse LUT view as a 1x1 fallback when SSAO off
      const bind = device.createBindGroup({
        layout: compositePipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: currentInputs.sceneView },
          { binding: 1, resource: linearSampler },
          { binding: 2, resource: bloomView },
          { binding: 3, resource: lutView },
          { binding: 4, resource: aoView },
          { binding: 5, resource: { buffer: compositeUniforms } },
        ],
      });
      const target = caps.dof && dofTarget ? dofTarget.view : ctx.outputView;
      const pass = encoder.beginRenderPass({
        label: 'composite',
        colorAttachments: [
          { view: target, loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } },
        ],
      });
      pass.setPipeline(compositePipeline);
      pass.setBindGroup(0, bind);
      pass.draw(3);
      pass.end();
      stats.encoded += 1;
    }

    // DOF: reads the composite copy + depth; writes to swap-chain.
    if (caps.dof && dofPipeline && dofTarget && dofUniforms) {
      const bind = device.createBindGroup({
        layout: dofPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: dofTarget.view },
          { binding: 1, resource: linearSampler },
          { binding: 2, resource: currentInputs.depthView },
          { binding: 3, resource: { buffer: dofUniforms } },
        ],
      });
      const pass = encoder.beginRenderPass({
        label: 'dof',
        colorAttachments: [
          { view: ctx.outputView, loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } },
        ],
      });
      pass.setPipeline(dofPipeline);
      pass.setBindGroup(0, bind);
      pass.draw(3);
      pass.end();
      stats.encoded += 1;
    }
  };

  const pass: Pass = {
    name: 'postfx',
    encode,
    dispose(): void {
      if (disposed) return;
      disposed = true;
      destroyMips();
      lutTexture.destroy();
      bloomDownUniforms.destroy();
      bloomUpUniforms.destroy();
      compositeUniforms.destroy();
      ssaoUniforms?.destroy();
      dofUniforms?.destroy();
    },
  };

  return {
    pass,
    setInputs,
    dispose: () => pass.dispose(),
    get stats() {
      return stats;
    },
  };
};

interface EngineTargetTex {
  texture: GPUTexture;
  view: GPUTextureView;
  destroy(): void;
}

const createTarget = (
  device: GPUDevice,
  label: string,
  width: number,
  height: number,
  format: GPUTextureFormat,
): EngineTargetTex => {
  const texture = device.createTexture({
    label,
    size: { width: Math.max(1, width), height: Math.max(1, height) },
    format,
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
  });
  return {
    texture,
    view: texture.createView(),
    destroy() {
      texture.destroy();
    },
  };
};

/** Bytes-per-pixel helper used by tests to assert NFR7 (post memory budget). */
export const postFxBytes = (width: number, height: number, caps: PostFxCaps, bloomMipLevels = BLOOM_MIPS_DEFAULT): number => {
  let total = 0;
  // HDR scene colour (rgba16float): 8 bytes/pixel.
  total += width * height * 8;
  // Bloom mips.
  if (caps.bloom) {
    let w = width;
    let h = height;
    for (let i = 0; i < bloomMipLevels; i += 1) {
      w = Math.max(1, Math.floor(w / 2));
      h = Math.max(1, Math.floor(h / 2));
      total += w * h * 8;
    }
  }
  // LUT.
  if (caps.lut) total += 32 * 32 * 32 * 4; // 128 KB
  // SSAO target.
  if (caps.ssao) total += width * height * 1;
  // DOF copy target (output format = bgra8unorm → 4 bytes/pixel).
  if (caps.dof) total += width * height * 4;
  return total;
};

export const BLOOM_MIP_LEVELS = BLOOM_MIPS_DEFAULT;
