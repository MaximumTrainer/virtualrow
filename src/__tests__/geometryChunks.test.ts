import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  CHUNK_VIEW_DISTANCE_SCENE_UNITS,
  MAX_GEOMETRY_CHUNKS,
  chunkCountForRoute,
  chunkProgressRanges,
  chunkSegmentCount,
  isChunkWithinViewDistance,
} from '../components/rower3d/geometryChunks';

describe('chunkCountForRoute', () => {
  it('leaves a short course as a single chunk', () => {
    expect(chunkCountForRoute(500)).toBe(1);
    expect(chunkCountForRoute(1500)).toBe(1);
  });

  it('splits a long course so distant water can be skipped', () => {
    expect(chunkCountForRoute(9000)).toBe(6);
  });

  it('caps the count so a marathon does not become a draw-call storm', () => {
    expect(chunkCountForRoute(100_000)).toBe(MAX_GEOMETRY_CHUNKS);
    expect(MAX_GEOMETRY_CHUNKS).toBe(16);
  });

  it('treats a degenerate length as one chunk', () => {
    expect(chunkCountForRoute(0)).toBe(1);
    expect(chunkCountForRoute(Number.NaN)).toBe(1);
  });
});

describe('chunkProgressRanges', () => {
  it('covers the whole curve exactly once', () => {
    const ranges = chunkProgressRanges(4);
    expect(ranges).toHaveLength(4);
    expect(ranges[0].from).toBe(0);
    expect(ranges[3].to).toBe(1);
  });

  it('hands adjacent chunks the identical boundary, so strips meet without a seam', () => {
    const ranges = chunkProgressRanges(7);
    ranges.slice(1).forEach((range, i) => {
      expect(range.from).toBe(ranges[i].to);
    });
  });

  it('returns the whole curve for a single chunk', () => {
    expect(chunkProgressRanges(1)).toEqual([{ from: 0, to: 1 }]);
    expect(chunkProgressRanges(0)).toEqual([{ from: 0, to: 1 }]);
  });
});

describe('chunkSegmentCount', () => {
  it('keeps the resolution a whole-route build would have used', () => {
    expect(chunkSegmentCount(800, { from: 0, to: 0.25 })).toBe(200);
  });

  it('never drops below a drawable single segment', () => {
    expect(chunkSegmentCount(50, { from: 0, to: 0.001 })).toBe(1);
  });
});

describe('isChunkWithinViewDistance', () => {
  const bounds = (x: number, radius: number) =>
    new THREE.Sphere(new THREE.Vector3(x, 0, 0), radius);

  it('keeps the chunk the boat is sitting in', () => {
    expect(isChunkWithinViewDistance(bounds(0, 50), new THREE.Vector3(0, 0, 0))).toBe(true);
  });

  it('drops a chunk whose nearest edge is past the fog', () => {
    const farAway = CHUNK_VIEW_DISTANCE_SCENE_UNITS + 200;
    expect(
      isChunkWithinViewDistance(bounds(farAway, 50), new THREE.Vector3(0, 0, 0)),
    ).toBe(false);
  });

  it('measures from the chunk edge, not its centre', () => {
    const centre = CHUNK_VIEW_DISTANCE_SCENE_UNITS + 100;
    expect(
      isChunkWithinViewDistance(bounds(centre, 300), new THREE.Vector3(0, 0, 0)),
    ).toBe(true);
  });

  it('keeps a chunk whose bounds were never computed', () => {
    expect(isChunkWithinViewDistance(null, new THREE.Vector3(0, 0, 0))).toBe(true);
  });
});
