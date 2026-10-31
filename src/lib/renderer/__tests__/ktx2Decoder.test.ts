/**
 * P5 (#562 AC8) — unit coverage for the KTX2 → BC7 decoder's control flow.
 *
 * The real decoder runs the vendored Basis WASM transcoder in a browser;
 * jsdom cannot execute the injected `<script>` tag, so this suite exercises
 * every branch by stubbing the environment: `document` + `createImageBitmap`
 * gate (`hasBrowserRuntime`), script injection + load callback, the
 * `window.BASIS` factory, and the `KTX2File` methods the decoder calls.
 *
 * The Playwright smoke on `/smoke/scenery` provides the end-to-end check
 * against the real transcoder; this file keeps the fallback and transcode-
 * loop branches honest without a GPU.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Ktx2Decoded } from '../engine/ktx2Decoder';

type DecodeFn = (url: string) => Promise<Ktx2Decoded | null>;

const importFresh = async (): Promise<{ decode: DecodeFn }> => {
  vi.resetModules();
  const mod = (await import('../engine/ktx2Decoder')) as { decode: DecodeFn };
  return { decode: mod.decode };
};

const makeKtx2File = (overrides: Partial<Record<string, unknown>> = {}) => ({
  isValid: () => true,
  isUASTC: () => true,
  startTranscoding: () => true,
  getWidth: () => 8,
  getHeight: () => 8,
  getLevels: () => 2,
  getLayers: () => 1,
  getFaces: () => 1,
  getImageLevelInfo: (mip: number) => ({
    origWidth: mip === 0 ? 8 : 4,
    origHeight: mip === 0 ? 8 : 4,
    width: mip === 0 ? 8 : 4,
    height: mip === 0 ? 8 : 4,
  }),
  getImageTranscodedSizeInBytes: (mip: number) => (mip === 0 ? 64 : 16),
  transcodeImage: (dst: Uint8Array) => {
    dst.fill(0xaa);
    return true;
  },
  close: () => undefined,
  delete: () => undefined,
  ...overrides,
});

const installBrowserGlobals = (opts: { fetchOk?: boolean; basis?: unknown } = {}): void => {
  const fakeDoc = {
    createElement: () => {
      const el = {
        src: '',
        async: false,
        dataset: {} as Record<string, string>,
        addEventListener: (event: string, cb: () => void) => {
          if (event === 'load') queueMicrotask(cb);
        },
      };
      return el as unknown as HTMLScriptElement;
    },
    querySelector: () => null,
    head: { appendChild: (_el: unknown) => _el },
  };
  Object.defineProperty(globalThis, 'document', { value: fakeDoc, configurable: true });
  Object.defineProperty(globalThis, 'createImageBitmap', { value: () => Promise.resolve({}), configurable: true });
  Object.defineProperty(globalThis, 'fetch', {
    value: () =>
      Promise.resolve({
        ok: opts.fetchOk !== false,
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(1024)),
      } as Response),
    configurable: true,
  });
  Object.defineProperty(globalThis, 'BASIS', { value: opts.basis, configurable: true, writable: true });
};

const resetGlobals = (): void => {
  for (const name of ['document', 'createImageBitmap', 'fetch', 'BASIS']) {
    try {
      // Property may or may not be defined depending on earlier tests.
      Object.defineProperty(globalThis, name, { value: undefined, configurable: true });
    } catch {
      /* ignore */
    }
  }
};

describe('ktx2Decoder', () => {
  afterEach(() => {
    resetGlobals();
    vi.resetModules();
  });

  it('returns null when the browser gate fails (no document / no createImageBitmap)', async () => {
    const { decode } = await importFresh();
    const result = await decode('/assets/flora/atlas.ktx2');
    expect(result).toBeNull();
  });

  it('returns null when window.BASIS never registers', async () => {
    installBrowserGlobals({ basis: undefined });
    const { decode } = await importFresh();
    const result = await decode('/assets/flora/atlas.ktx2');
    expect(result).toBeNull();
  });

  it('transcodes every mip when the vendored BASIS surfaces', async () => {
    const seen: number[] = [];
    const file = makeKtx2File({
      transcodeImage: (dst: Uint8Array, mip: number) => {
        seen.push(mip);
        dst.fill(0x55);
        return true;
      },
    });
    const basis = vi.fn(async () => ({
      initializeBasis: vi.fn(),
      KTX2File: vi.fn(() => file),
    }));
    installBrowserGlobals({ basis });
    const { decode } = await importFresh();
    const result = await decode('/assets/flora/atlas.ktx2');
    expect(result).not.toBeNull();
    expect(result!.width).toBe(8);
    expect(result!.height).toBe(8);
    expect(result!.levels.length).toBe(2);
    expect(seen).toEqual([0, 1]);
  });

  it('returns null when the KTX2 is ETC1S, not UASTC', async () => {
    const file = makeKtx2File({ isUASTC: () => false });
    const basis = vi.fn(async () => ({
      initializeBasis: vi.fn(),
      KTX2File: vi.fn(() => file),
    }));
    installBrowserGlobals({ basis });
    const { decode } = await importFresh();
    expect(await decode('/x.ktx2')).toBeNull();
  });

  it('returns null when transcoding a level fails', async () => {
    const file = makeKtx2File({
      transcodeImage: () => false,
    });
    const basis = vi.fn(async () => ({
      initializeBasis: vi.fn(),
      KTX2File: vi.fn(() => file),
    }));
    installBrowserGlobals({ basis });
    const { decode } = await importFresh();
    expect(await decode('/x.ktx2')).toBeNull();
  });

  it('returns null on a 404 fetch', async () => {
    const basis = vi.fn(async () => ({
      initializeBasis: vi.fn(),
      KTX2File: vi.fn(() => makeKtx2File()),
    }));
    installBrowserGlobals({ basis, fetchOk: false });
    const { decode } = await importFresh();
    expect(await decode('/missing.ktx2')).toBeNull();
  });

  it('returns null when the BASIS factory itself throws', async () => {
    const basis = vi.fn(async () => {
      throw new Error('wasm init failed');
    });
    installBrowserGlobals({ basis });
    const { decode } = await importFresh();
    expect(await decode('/x.ktx2')).toBeNull();
  });

  it('returns null when fetch throws (network failure)', async () => {
    installBrowserGlobals({
      basis: vi.fn(async () => ({
        initializeBasis: vi.fn(),
        KTX2File: vi.fn(() => makeKtx2File()),
      })),
    });
    Object.defineProperty(globalThis, 'fetch', {
      value: () => Promise.reject(new Error('offline')),
      configurable: true,
    });
    const { decode } = await importFresh();
    expect(await decode('/x.ktx2')).toBeNull();
  });

  it('returns null when the KTX2File constructor throws, and the finally cleanup swallows close errors', async () => {
    const file = makeKtx2File({
      isValid: () => {
        throw new Error('corrupted');
      },
      close: () => {
        throw new Error('close failed');
      },
    });
    const basis = vi.fn(async () => ({
      initializeBasis: vi.fn(),
      KTX2File: vi.fn(() => file),
    }));
    installBrowserGlobals({ basis });
    const { decode } = await importFresh();
    expect(await decode('/x.ktx2')).toBeNull();
  });

  it('stops at the first 0-origWidth level (basisu padded tail)', async () => {
    const file = makeKtx2File({
      getLevels: () => 3,
      getImageLevelInfo: (mip: number) => ({
        origWidth: mip < 2 ? 8 >> mip : 0,
        origHeight: mip < 2 ? 8 >> mip : 0,
        width: 8 >> mip,
        height: 8 >> mip,
      }),
    });
    const basis = vi.fn(async () => ({
      initializeBasis: vi.fn(),
      KTX2File: vi.fn(() => file),
    }));
    installBrowserGlobals({ basis });
    const { decode } = await importFresh();
    const result = await decode('/x.ktx2');
    expect(result!.levels.length).toBe(2);
  });
});

beforeEach(() => {
  resetGlobals();
});
