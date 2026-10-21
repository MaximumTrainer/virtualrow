/**
 * P5 (#562): the KTX2 decoder's own chunk. The engine's main chunk pulls
 * `textureLoader.ts`, which dynamic-imports this file (and this file alone)
 * only when a KTX2 asset is actually requested. Vite / Rollup split this
 * off into its own JS chunk — the test suite's bundle check reads the Vite
 * manifest to prove it.
 *
 * The real transcoder (`basis_universal` + `ktx-parse`) is NOT installed
 * yet on this branch (deliberate — see the atlas-authoring note in
 * `docs/webgpu-migration/p5-flora-lod.md` and the follow-up item in
 * [#556]). The decoder returns `null` today, which drives the loader to
 * its uncompressed PNG fallback; swapping in Basis Universal is a
 * drop-in replacement for the body of `decode`.
 *
 * The function signature and its lazy-chunk boundary are the stable part of
 * P5. Code that calls it (`textureLoader.decodeKtx2`) handles `null` as
 * "transcoder unavailable" and takes the PNG path — matching Dan's D1-a
 * / D2-a decisions on #562.
 */

export interface Ktx2Decoded {
  width: number;
  height: number;
  levels: Uint8Array[];
}

export const decode = async (_url: string): Promise<Ktx2Decoded | null> => {
  // Intentional pass-through: triggers the PNG fallback in `textureLoader`.
  // Follow-up (parked in #556): wire basis_universal + ktx-parse here. The
  // caller already handles `null`, so this file is the only one that needs
  // to change when the transcoder arrives.
  return null;
};

/** Opaque marker that lets the Vite bundle test identify this chunk. */
export const KTX2_LAZY_CHUNK_MARKER = 'ktx2Decoder:lazy';
