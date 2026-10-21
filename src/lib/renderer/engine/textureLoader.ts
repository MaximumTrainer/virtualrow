/**
 * P5 (#562 FR2 / D3-a): the lazy entry point for KTX2/Basis-compressed
 * textures. The transcoder is a dynamic import so it never lands in the
 * engine's main chunk — the Vite bundle check in `textureLoader.test.ts`
 * asserts this (AC2 of #562).
 *
 * `loadFloraAtlas` picks between KTX2 (`high`+) and uncompressed PNG
 * (`basic` / `low` / `medium`) from the tier, following D4-a of #562 (one
 * atlas, row per species).
 *
 * The KTX2 transcoder (`basis_universal` + `ktx-parse`) is NOT currently
 * installed as a dep — it ships as a lazy sibling chunk under
 * `./ktx2Decoder.ts`. When the decoder returns `null` (its default on this
 * branch — the real transcoder lands in a #556 follow-up), the loader falls
 * back to the uncompressed PNG. Telemetry carries which path was taken.
 */

/// <reference types="@webgpu/types" />

import { createPlaceholderTexture, textureBytes, uploadBc7, uploadFromImageBitmap, type EngineTexture } from './textures';

export type AtlasKind = 'ktx2' | 'png' | 'placeholder';

export interface AtlasHandle {
  texture: EngineTexture;
  kind: AtlasKind;
  transcodedMs: number;
}

export interface AtlasSource {
  /** Base URL (without extension) of the asset: the loader appends `.ktx2` or `.png`. */
  url: string;
  /** Preferred width × height for the uncompressed fallback. KTX2 carries its own. */
  pngWidth: number;
  pngHeight: number;
}

export const highTierKtx2 = (tier?: string): boolean => tier === 'high' || tier === 'extra-high';

/**
 * Load the flora sprite atlas. On `high`+ the loader tries the KTX2 path
 * (lazy-imports the decoder); on `medium` and below it uses the sibling PNG.
 * In test or SSR environments without `fetch`/`createImageBitmap`, the loader
 * returns a placeholder — the smoke still exercises the atlasKind telemetry.
 */
export const loadFloraAtlas = async (
  device: GPUDevice,
  tier: string | undefined,
  source: AtlasSource,
): Promise<AtlasHandle> => {
  const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
  if (highTierKtx2(tier)) {
    const decoded = await decodeKtx2(source.url + '.ktx2');
    if (decoded) {
      const texture = uploadBc7(device, decoded.width, decoded.height, decoded.levels, {
        label: 'flora-atlas-bc7',
        srgb: true,
      });
      return { texture, kind: 'ktx2', transcodedMs: elapsed(t0) };
    }
    // Fall through to PNG when the decoder isn't wired yet.
  }
  const bitmap = await loadBitmap(source.url + '.png');
  if (bitmap) {
    const texture = uploadFromImageBitmap(device, bitmap, { label: 'flora-atlas-png', srgb: true });
    return { texture, kind: 'png', transcodedMs: elapsed(t0) };
  }
  const texture = createPlaceholderTexture(device, [40, 60, 32, 255]);
  return { texture, kind: 'placeholder', transcodedMs: elapsed(t0) };
};

const elapsed = (t0: number): number =>
  typeof performance !== 'undefined' ? Math.max(0, performance.now() - t0) : 0;

export interface Ktx2Decoded {
  width: number;
  height: number;
  /** One `Uint8Array` of BC7 bytes per mip level, base first. */
  levels: Uint8Array[];
}

/**
 * Dynamic import boundary — the decoder module lives in its own chunk so the
 * engine's main chunk doesn't pull `basis_universal` / `ktx-parse` into the
 * ride bundle unless a KTX2 asset is actually requested (AC2 of #562).
 */
export const decodeKtx2 = async (url: string): Promise<Ktx2Decoded | null> => {
  try {
    const mod = (await import('./ktx2Decoder')) as { decode?: (url: string) => Promise<Ktx2Decoded | null> };
    if (typeof mod.decode !== 'function') return null;
    return await mod.decode(url);
  } catch {
    return null;
  }
};

const loadBitmap = async (url: string): Promise<ImageBitmap | null> => {
  const fetchFn = (globalThis as unknown as { fetch?: typeof fetch }).fetch;
  const createBitmap = (globalThis as unknown as { createImageBitmap?: typeof createImageBitmap })
    .createImageBitmap;
  if (!fetchFn || !createBitmap) return null;
  try {
    const res = await fetchFn(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    return await createBitmap(blob);
  } catch {
    return null;
  }
};

/**
 * Expected `atlasBytes` for the flora sprite atlas at a given size, under
 * both the KTX2 (BC7) and uncompressed (RGBA8) paths. Exported for the
 * `atlasBytes.test.ts` ratio check (AC3 of #562) so the assertion can run
 * without a live device.
 */
export const expectedAtlasBytes = (
  width: number,
  height: number,
): { ktx2: number; uncompressed: number } => {
  const mipCount = Math.floor(Math.log2(Math.max(width, height))) + 1;
  return {
    ktx2: textureBytes(width, height, 'bc7-rgba-unorm-srgb', mipCount),
    uncompressed: textureBytes(width, height, 'rgba8unorm-srgb', mipCount),
  };
};
