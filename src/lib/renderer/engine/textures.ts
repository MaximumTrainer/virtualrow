/**
 * P5 (#562 FR1): texture pipeline primitives for the WebGPU engine.
 *
 * - `uploadFromImageBitmap` — RGBA8 sRGB (or linear) upload with the usage
 *   bits a mipmap writer needs.
 * - `generateMips` — D5-a of #562: a tiny vs/fs pipeline per mip level. One
 *   draw per level reads the previous level and writes the next; portable
 *   across every WebGPU implementation (no `storage` texture format
 *   requirement, which SwiftShader is picky about).
 *
 * Every texture declares a `released` flag the device layer tracks for
 * `dispose()` (NFR of #562).
 */

/// <reference types="@webgpu/types" />

export interface EngineTexture {
  texture: GPUTexture;
  view: GPUTextureView;
  width: number;
  height: number;
  mipLevelCount: number;
  format: GPUTextureFormat;
  bytes: number;
  released: boolean;
  dispose(): void;
}

export interface UploadOpts {
  label?: string;
  srgb?: boolean;
  mipmap?: boolean;
}

const BYTES_PER_PIXEL: Record<string, number> = {
  'rgba8unorm': 4,
  'rgba8unorm-srgb': 4,
  'bgra8unorm': 4,
  'rgba16float': 8,
  'bc7-rgba-unorm': 1,
  'bc7-rgba-unorm-srgb': 1,
};

export const mipLevelCountFor = (w: number, h: number): number =>
  Math.floor(Math.log2(Math.max(w, h))) + 1;

export const textureBytes = (
  width: number,
  height: number,
  format: GPUTextureFormat,
  mipLevelCount: number,
): number => {
  const bpp = BYTES_PER_PIXEL[format] ?? 4;
  let total = 0;
  let w = width;
  let h = height;
  for (let i = 0; i < mipLevelCount; i += 1) {
    if (format.startsWith('bc7-')) {
      total += Math.ceil(w / 4) * Math.ceil(h / 4) * 16;
    } else {
      total += w * h * bpp;
    }
    w = Math.max(1, Math.floor(w / 2));
    h = Math.max(1, Math.floor(h / 2));
  }
  return total;
};

const makeHandle = (
  texture: GPUTexture,
  width: number,
  height: number,
  mipLevelCount: number,
  format: GPUTextureFormat,
): EngineTexture => {
  const view = texture.createView();
  const bytes = textureBytes(width, height, format, mipLevelCount);
  let released = false;
  return {
    texture,
    view,
    width,
    height,
    mipLevelCount,
    format,
    bytes,
    get released() {
      return released;
    },
    set released(v: boolean) {
      released = v;
    },
    dispose() {
      if (released) return;
      released = true;
      texture.destroy();
    },
  };
};

export const uploadFromImageBitmap = (
  device: GPUDevice,
  bitmap: ImageBitmap,
  opts: UploadOpts = {},
): EngineTexture => {
  const format: GPUTextureFormat = opts.srgb === false ? 'rgba8unorm' : 'rgba8unorm-srgb';
  const mipLevelCount = opts.mipmap === false ? 1 : mipLevelCountFor(bitmap.width, bitmap.height);
  const texture = device.createTexture({
    label: opts.label ?? 'engine-tex',
    size: { width: bitmap.width, height: bitmap.height },
    format,
    mipLevelCount,
    usage:
      GPUTextureUsage.TEXTURE_BINDING |
      GPUTextureUsage.COPY_DST |
      GPUTextureUsage.RENDER_ATTACHMENT,
  });
  device.queue.copyExternalImageToTexture?.(
    { source: bitmap },
    { texture, mipLevel: 0 },
    { width: bitmap.width, height: bitmap.height },
  );
  if (mipLevelCount > 1) generateMips(device, texture, bitmap.width, bitmap.height, mipLevelCount, format);
  return makeHandle(texture, bitmap.width, bitmap.height, mipLevelCount, format);
};

/**
 * Create a BC7-formatted texture handle from decoded KTX2 bytes. The caller
 * supplies the uncompressed byte length is not needed — BC7's block layout
 * fixes it. One `writeTexture` per mip level.
 */
export const uploadBc7 = (
  device: GPUDevice,
  width: number,
  height: number,
  mipData: ReadonlyArray<Uint8Array>,
  opts: { label?: string; srgb?: boolean } = {},
): EngineTexture => {
  const format: GPUTextureFormat = opts.srgb === false ? 'bc7-rgba-unorm' : 'bc7-rgba-unorm-srgb';
  const mipLevelCount = mipData.length;
  const texture = device.createTexture({
    label: opts.label ?? 'engine-bc7',
    size: { width, height },
    format,
    mipLevelCount,
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });
  let w = width;
  let h = height;
  for (let i = 0; i < mipLevelCount; i += 1) {
    const bytesPerRow = Math.max(1, Math.ceil(w / 4)) * 16;
    device.queue.writeTexture?.(
      { texture, mipLevel: i },
      mipData[i] as BufferSource,
      { bytesPerRow, rowsPerImage: Math.max(1, Math.ceil(h / 4)) },
      { width: w, height: h },
    );
    w = Math.max(1, Math.floor(w / 2));
    h = Math.max(1, Math.floor(h / 2));
  }
  return makeHandle(texture, width, height, mipLevelCount, format);
};

/**
 * Generate mip levels 1..N on the GPU using a tiny vs/fs pipeline per level
 * (D5-a of #562). Writes `mipLevelCount - 1` levels; the base level must
 * already be uploaded.
 *
 * The pipeline + sampler are not cached — mipmap generation runs once per
 * upload and the cost of recreating the pipeline is negligible against the
 * texture upload itself. If mipmap generation becomes a hot path, cache in
 * a module-level map keyed by `format`.
 */
export const generateMips = (
  device: GPUDevice,
  texture: GPUTexture,
  width: number,
  height: number,
  mipLevelCount: number,
  format: GPUTextureFormat,
): void => {
  if (mipLevelCount <= 1) return;
  const module = device.createShaderModule({
    label: 'mipgen',
    code: `
      struct VSOut { @builtin(position) pos: vec4<f32>, @location(0) uv: vec2<f32> };
      @vertex fn vs(@builtin(vertex_index) vi: u32) -> VSOut {
        var p = array<vec2<f32>, 3>(
          vec2<f32>(-1.0, -3.0),
          vec2<f32>(-1.0,  1.0),
          vec2<f32>( 3.0,  1.0),
        );
        var out: VSOut;
        let xy = p[vi];
        out.pos = vec4<f32>(xy, 0.0, 1.0);
        out.uv = vec2<f32>((xy.x + 1.0) * 0.5, 1.0 - (xy.y + 1.0) * 0.5);
        return out;
      }
      @group(0) @binding(0) var src: texture_2d<f32>;
      @group(0) @binding(1) var samp: sampler;
      @fragment fn fs(in: VSOut) -> @location(0) vec4<f32> {
        return textureSample(src, samp, in.uv);
      }
    `,
  });
  const pipeline = device.createRenderPipeline({
    label: 'mipgen',
    layout: 'auto',
    vertex: { module, entryPoint: 'vs' },
    fragment: { module, entryPoint: 'fs', targets: [{ format }] },
    primitive: { topology: 'triangle-list' },
  });
  const sampler = device.createSampler({ minFilter: 'linear', magFilter: 'linear' });
  const encoder = device.createCommandEncoder({ label: 'mipgen' });
  let w = width;
  let h = height;
  for (let i = 1; i < mipLevelCount; i += 1) {
    w = Math.max(1, Math.floor(w / 2));
    h = Math.max(1, Math.floor(h / 2));
    const srcView = texture.createView({ baseMipLevel: i - 1, mipLevelCount: 1 });
    const dstView = texture.createView({ baseMipLevel: i, mipLevelCount: 1 });
    const bind = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: srcView },
        { binding: 1, resource: sampler },
      ],
    });
    const pass = encoder.beginRenderPass({
      colorAttachments: [{ view: dstView, loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 0 } }],
    });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bind);
    pass.draw(3);
    pass.end();
  }
  device.queue.submit([encoder.finish()]);
};

/**
 * Minimal 2×2 placeholder texture. Used as the default binding when a
 * material declares an optional detail-texture slot but the tier doesn't
 * wire a real one in (#562 FR6).
 */
export const createPlaceholderTexture = (
  device: GPUDevice,
  rgba: [number, number, number, number] = [0, 0, 0, 0],
): EngineTexture => {
  const texture = device.createTexture({
    label: 'placeholder',
    size: { width: 2, height: 2 },
    format: 'rgba8unorm',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });
  const bytes = new Uint8Array(4 * 4);
  for (let i = 0; i < 4; i += 1) {
    bytes[i * 4 + 0] = rgba[0];
    bytes[i * 4 + 1] = rgba[1];
    bytes[i * 4 + 2] = rgba[2];
    bytes[i * 4 + 3] = rgba[3];
  }
  device.queue.writeTexture?.(
    { texture },
    bytes,
    { bytesPerRow: 8 },
    { width: 2, height: 2 },
  );
  return makeHandle(texture, 2, 2, 1, 'rgba8unorm');
};
