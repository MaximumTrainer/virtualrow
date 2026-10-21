/**
 * P5 (#562) KTX2 → BC7 decoder, in its own lazy chunk.
 *
 * The engine's main chunk pulls `textureLoader.ts`, which dynamic-imports this
 * file (and this file alone) only when a KTX2 asset is actually requested.
 * Vite / Rollup split this off into its own JS chunk — the test suite's
 * bundle check reads the Vite manifest to prove it.
 *
 * The transcoder itself is vendored from three.js at
 * `public/assets/basis/basis_transcoder.{js,wasm}` (Khronos' reference build;
 * the three bundle is just a convenient source, no three code is pulled in).
 * We inject it as a classic `<script>` tag, which lets the Emscripten module
 * resolve its sibling `.wasm` via `document.currentScript.src` the way three
 * does. The transcoder registers `window.BASIS` as a module factory; one call
 * initialises it, then every `.ktx2` is read with `BASIS.KTX2File`, which has
 * its own container parser and `.transcodeImage` for UASTC → BC7.
 *
 * Any failure (no document, WASM blocked, transcoder throws) returns `null`
 * so `textureLoader` falls through to the uncompressed PNG. D1-a of #562.
 */
import { assetUrl } from '../../utils/assetUrl';

export interface Ktx2Decoded {
  width: number;
  height: number;
  levels: Uint8Array[];
}

/** Opaque marker that lets the Vite bundle test identify this chunk. */
export const KTX2_LAZY_CHUNK_MARKER = 'ktx2Decoder:lazy';

/** TranscoderFormat.BC7_M5 — the sRGB UASTC → BC7_RGBA mode three uses. */
const TRANSCODER_FORMAT_BC7_M5 = 7;

/** Minimum fields of the vendored Basis transcoder we rely on. */
interface BasisModule {
  initializeBasis?: () => void;
  KTX2File: new (data: Uint8Array) => BasisKtx2File;
}

interface BasisKtx2Level {
  origWidth: number;
  origHeight: number;
  width: number;
  height: number;
}

interface BasisKtx2File {
  close: () => void;
  delete: () => void;
  isValid: () => boolean;
  isUASTC: () => boolean;
  getWidth: () => number;
  getHeight: () => number;
  getLevels: () => number;
  getLayers: () => number;
  getFaces: () => number;
  getImageLevelInfo: (mip: number, layer: number, face: number) => BasisKtx2Level;
  getImageTranscodedSizeInBytes: (
    mip: number,
    layer: number,
    face: number,
    transcoderFormat: number,
  ) => number;
  startTranscoding: () => boolean;
  transcodeImage: (
    dst: Uint8Array,
    mip: number,
    layer: number,
    face: number,
    transcoderFormat: number,
    getAlphaForOpaqueFormats: number,
    channel0: number,
    channel1: number,
  ) => boolean;
}

type BasisFactory = (config: { locateFile?: (name: string) => string }) => Promise<BasisModule>;

interface WindowWithBasis {
  BASIS?: BasisFactory;
}

let basisModule: BasisModule | null = null;
let basisInit: Promise<BasisModule | null> | null = null;

const loadBasisScript = (scriptUrl: string): Promise<void> =>
  // `initBasis` memoises its result, so this is called at most once per
  // module instance — no DOM dedupe pass needed on top. If the module is
  // reloaded by HMR the memoised promise is thrown away with it, and a
  // second script tag is harmless (the Emscripten factory binds to the
  // most recent `window.BASIS`).
  new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = scriptUrl;
    el.async = true;
    el.addEventListener('load', () => resolve(), { once: true });
    el.addEventListener('error', () => reject(new Error('basis script load error')), { once: true });
    document.head.appendChild(el);
  });

/**
 * jsdom has `document` but not `createImageBitmap`, and dropping a `<script>`
 * tag into it never fires `load` — the promise would hang. Gate on the same
 * capability the sibling PNG path checks, so tests stay at `null` and the
 * placeholder path exercises the loader's fallback.
 */
const hasBrowserRuntime = (): boolean =>
  typeof document !== 'undefined' &&
  typeof (globalThis as unknown as { createImageBitmap?: unknown }).createImageBitmap === 'function';

const initBasis = async (): Promise<BasisModule | null> => {
  if (basisModule) return basisModule;
  if (basisInit) return basisInit;
  if (!hasBrowserRuntime()) return null;
  basisInit = (async () => {
    const scriptUrl = assetUrl('/assets/basis/basis_transcoder.js');
    const wasmUrl = assetUrl('/assets/basis/basis_transcoder.wasm');
    try {
      await loadBasisScript(scriptUrl);
      const factory = (globalThis as unknown as WindowWithBasis).BASIS;
      if (typeof factory !== 'function') return null;
      const mod = await factory({ locateFile: () => wasmUrl });
      mod.initializeBasis?.();
      basisModule = mod;
      return mod;
    } catch {
      return null;
    }
  })();
  return basisInit;
};

const fetchBytes = async (url: string): Promise<Uint8Array | null> => {
  const fetchFn = (globalThis as unknown as { fetch?: typeof fetch }).fetch;
  if (!fetchFn) return null;
  try {
    const res = await fetchFn(url);
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    return new Uint8Array(buf);
  } catch {
    return null;
  }
};

/**
 * Transcode a UASTC KTX2 at `url` into BC7_RGBA mip levels. Returns `null`
 * on any failure — the loader falls through to the PNG path.
 */
export const decode = async (url: string): Promise<Ktx2Decoded | null> => {
  const mod = await initBasis();
  if (!mod) return null;
  const bytes = await fetchBytes(url);
  if (!bytes) return null;
  let file: BasisKtx2File | null = null;
  try {
    file = new mod.KTX2File(bytes);
    if (!file.isValid()) return null;
    if (!file.isUASTC()) return null; // D4-b: we encode UASTC only.
    if (!file.startTranscoding()) return null;
    const width = file.getWidth();
    const height = file.getHeight();
    const levelCount = file.getLevels();
    if (!width || !height || !levelCount) return null;
    const levels: Uint8Array[] = [];
    for (let mip = 0; mip < levelCount; mip += 1) {
      const info = file.getImageLevelInfo(mip, 0, 0);
      // Skip the padded-to-4x4 bookkeeping levels basisu emits for 2x2 and 1x1
      // — WebGPU's mip chain stops at the last level whose origWidth or
      // origHeight is still >= 1, and the transcoder returns the same 4x4
      // block for everything below that. Keeping the chain in sync with the
      // mip count `textureLoader` passes to `uploadBc7` is what matters.
      if (info.origWidth === 0 || info.origHeight === 0) break;
      const size = file.getImageTranscodedSizeInBytes(mip, 0, 0, TRANSCODER_FORMAT_BC7_M5);
      if (!size) return null;
      const dst = new Uint8Array(size);
      const ok = file.transcodeImage(dst, mip, 0, 0, TRANSCODER_FORMAT_BC7_M5, 0, -1, -1);
      if (!ok) return null;
      levels.push(dst);
    }
    return { width, height, levels };
  } catch {
    return null;
  } finally {
    try {
      file?.close();
      file?.delete();
    } catch {
      /* ignore */
    }
  }
};
