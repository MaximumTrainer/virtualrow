import { useEffect, useMemo, useState } from 'react';
import * as THREE from 'three';

/**
 * Build a route's chunked strip geometry without blocking the first frame.
 *
 * The chunks the boat starts inside are built synchronously, because nothing
 * can be drawn without them. The rest arrive one per idle callback, so a 20 km
 * course paints its opening bend immediately instead of after every metre of
 * water and both banks have been tessellated (#224).
 *
 * Geometry is disposed when the build inputs change and on unmount; a chunk
 * that never finished is simply never allocated.
 *
 * @param chunkCount  How many chunks the route was split into.
 * @param buildChunk  Builds the geometry for one chunk index. Must be stable.
 * @param eagerChunks Chunks to build before the first paint, counted from the start.
 */
export const useProgressiveChunks = (
  chunkCount: number,
  buildChunk: (index: number) => THREE.BufferGeometry,
  eagerChunks = 1,
): Array<THREE.BufferGeometry | null> => {
  // Built during render, not in an effect: the opening chunks have to exist
  // before the first paint, and a state round-trip would cost an extra pass.
  const opening = useMemo(
    () =>
      Array.from({ length: chunkCount }, (_, index) =>
        index < eagerChunks ? buildChunk(index) : null,
      ),
    [chunkCount, buildChunk, eagerChunks],
  );

  const [built, setBuilt] = useState({ from: opening, chunks: opening });
  if (built.from !== opening) setBuilt({ from: opening, chunks: opening });

  useEffect(() => {
    if (chunkCount <= eagerChunks) return;

    const chunks = [...opening];
    let cancelled = false;
    let cancelPending: (() => void) | null = null;

    const buildNext = (index: number) => {
      if (cancelled || index >= chunkCount) return;
      chunks[index] = buildChunk(index);
      setBuilt({ from: opening, chunks: [...chunks] });
      cancelPending = scheduleIdle(() => buildNext(index + 1));
    };

    cancelPending = scheduleIdle(() => buildNext(eagerChunks));

    return () => {
      cancelled = true;
      cancelPending?.();
      chunks.slice(eagerChunks).forEach((geometry) => geometry?.dispose());
    };
  }, [opening, chunkCount, buildChunk, eagerChunks]);

  useEffect(
    () => () => opening.forEach((geometry) => geometry?.dispose()),
    [opening],
  );

  return built.chunks;
};

/**
 * Run `run` when the main thread is next free, and hand back its canceller.
 *
 * `requestIdleCallback` where the browser has one, a macrotask where it does
 * not (Safari, jsdom). The canceller closes over the function that scheduled
 * the work, so the two halves can never come from different implementations.
 */
const scheduleIdle = (run: () => void): (() => void) => {
  if (
    typeof requestIdleCallback === 'function' &&
    typeof cancelIdleCallback === 'function'
  ) {
    const cancel = cancelIdleCallback;
    const id = requestIdleCallback(() => run(), { timeout: 500 });
    return () => cancel(id);
  }
  const id = setTimeout(run, 0);
  return () => clearTimeout(id);
};
