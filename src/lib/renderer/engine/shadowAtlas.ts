/**
 * Shadow atlas (#559 FR3 / D2-a / D3-a). A single `depth32float` texture
 * divided into cascade tiles — one tile per cascade, laid out horizontally.
 * The shadow stage uses per-cascade viewport scissors on the atlas.
 *
 * Owned by the engine attach; released on dispose with the device.
 */

/// <reference types="@webgpu/types" />

export interface ShadowAtlas {
  readonly texture: GPUTexture;
  readonly view: GPUTextureView;
  /** Tile size in texels — one cascade is `tileSize × tileSize`. */
  readonly tileSize: number;
  /** Number of cascades laid out horizontally. */
  readonly cascades: number;
  /** Full atlas width in texels (`tileSize * cascades`). */
  readonly width: number;
  /** Full atlas height in texels (= `tileSize`). */
  readonly height: number;
  /** Bytes used by the atlas texture, read by `__ROWER3D_RENDER_STATS`. */
  readonly bytes: number;
  dispose(): void;
}

export const createShadowAtlas = (
  device: GPUDevice,
  tileSize: number,
  cascades: number,
): ShadowAtlas => {
  const tiles = Math.max(1, Math.min(4, Math.floor(cascades)));
  const size = Math.max(16, Math.floor(tileSize));
  const width = size * tiles;
  const height = size;
  const texture = device.createTexture({
    label: `shadow-atlas:${tiles}x${size}`,
    size: { width, height },
    format: 'depth32float',
    usage:
      GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
  });
  // depth32float = 4 bytes/texel; one layer; no mips.
  const bytes = width * height * 4;
  const view = texture.createView({ label: 'shadow-atlas:view' });

  let disposed = false;
  return {
    texture,
    view,
    tileSize: size,
    cascades: tiles,
    width,
    height,
    bytes,
    dispose() {
      if (disposed) return;
      disposed = true;
      texture.destroy();
    },
  };
};

/**
 * `(x, y, w, h)` viewport for cascade `i` on the atlas. Pass the result to
 * `GPURenderPassEncoder.setViewport` + `setScissorRect`.
 */
export const cascadeViewport = (
  atlas: ShadowAtlas,
  index: number,
): [number, number, number, number] => {
  const i = Math.max(0, Math.min(atlas.cascades - 1, Math.floor(index)));
  return [i * atlas.tileSize, 0, atlas.tileSize, atlas.tileSize];
};
