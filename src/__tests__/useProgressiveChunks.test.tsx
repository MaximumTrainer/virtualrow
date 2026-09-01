import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import * as THREE from 'three';
import { useProgressiveChunks } from '../hooks/useProgressiveChunks';

/**
 * jsdom has no `requestIdleCallback`, which is also the Safari story — so the
 * default run here exercises the macrotask fallback. The idle path gets its own
 * test below.
 */
describe('useProgressiveChunks', () => {
  let built: number[];
  let buildChunk: (index: number) => THREE.BufferGeometry;

  beforeEach(() => {
    built = [];
    buildChunk = (index: number) => {
      built.push(index);
      return new THREE.BufferGeometry();
    };
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('builds the opening chunk before the first render returns', () => {
    const { result } = renderHook(() => useProgressiveChunks(6, buildChunk));

    expect(built).toEqual([0]);
    expect(result.current[0]).toBeInstanceOf(THREE.BufferGeometry);
    expect(result.current.slice(1)).toEqual([null, null, null, null, null]);
  });

  it('fills in the rest of the route in the background', async () => {
    const { result } = renderHook(() => useProgressiveChunks(4, buildChunk));

    await waitFor(() => {
      expect(result.current.every((chunk) => chunk !== null)).toBe(true);
    });
    expect(built).toEqual([0, 1, 2, 3]);
  });

  it('builds every chunk eagerly when asked to', () => {
    renderHook(() => useProgressiveChunks(3, buildChunk, 3));
    expect(built).toEqual([0, 1, 2]);
  });

  it('uses requestIdleCallback when the browser offers one', async () => {
    const idle = vi.fn((run: IdleRequestCallback) => {
      setTimeout(() => run({ didTimeout: false, timeRemaining: () => 5 }), 0);
      return 1;
    });
    vi.stubGlobal('requestIdleCallback', idle);
    vi.stubGlobal('cancelIdleCallback', vi.fn());

    const { result } = renderHook(() => useProgressiveChunks(3, buildChunk));
    await waitFor(() => {
      expect(result.current.every((chunk) => chunk !== null)).toBe(true);
    });
    expect(idle).toHaveBeenCalled();
  });

  it('disposes every built chunk on unmount', async () => {
    const disposed: THREE.BufferGeometry[] = [];
    const trackingBuild = (index: number) => {
      const geometry = new THREE.BufferGeometry();
      geometry.dispose = () => disposed.push(geometry);
      built.push(index);
      return geometry;
    };

    const { result, unmount } = renderHook(() => useProgressiveChunks(3, trackingBuild));
    await waitFor(() => {
      expect(result.current.every((chunk) => chunk !== null)).toBe(true);
    });

    unmount();
    expect(disposed).toHaveLength(3);
  });

  it('stops building for a route the rower has already left', async () => {
    const { unmount } = renderHook(() => useProgressiveChunks(8, buildChunk));
    unmount();

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(built).toEqual([0]);
  });

  it('rebuilds from scratch when the route changes', async () => {
    const { rerender, result } = renderHook(
      ({ count }: { count: number }) => useProgressiveChunks(count, buildChunk),
      { initialProps: { count: 2 } },
    );
    await waitFor(() => expect(built).toEqual([0, 1]));

    rerender({ count: 3 });
    await waitFor(() => {
      expect(result.current).toHaveLength(3);
      expect(result.current.every((chunk) => chunk !== null)).toBe(true);
    });
    expect(built).toEqual([0, 1, 0, 1, 2]);
  });
});
