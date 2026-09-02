import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import type { Coordinate } from '../types/index';
import {
  createRouteCurve,
  distanceToProgress,
  getCurveDistances,
  getRoutePositionAtProgress,
} from '../components/rower3d/curve';
import { SCENE_SCALE } from '../components/rower3d/constants';
import { isChunkWithinViewDistance } from '../components/rower3d/geometryChunks';
import { createWaterChannelGeometry } from '../components/rower3d/waterGeometry';
import { chunkProgressRanges } from '../components/rower3d/geometryChunks';

/**
 * The per-frame cost #224 set out to bound.
 *
 * The sustained-frame-rate criterion cannot be honestly measured in Playwright:
 * the scene draws through SwiftShader there and, as `virtualrow.spec.ts`
 * already notes, the animation does not reliably advance under headless
 * automation at all — a 5,000-point route renders about two frames a minute,
 * so any fps number would describe the rasteriser. What *is* deterministic is
 * the CPU work the scene does every frame, which is what route simplification
 * and the distance table were optimised for. That is measured here.
 */

const METERS_PER_DEGREE_LAT = 111_195;
const ORIGIN_LAT = 51.45;
const LNG_SCALE = METERS_PER_DEGREE_LAT * Math.cos((ORIGIN_LAT * Math.PI) / 180);

const windingRoute = (points: number, lengthMeters: number, bends: number): Coordinate[] =>
  Array.from({ length: points }, (_, i) => {
    const t = i / (points - 1);
    return {
      lat: ORIGIN_LAT + (t * lengthMeters) / METERS_PER_DEGREE_LAT,
      lng: (Math.sin(t * bends * 2 * Math.PI) * 60) / LNG_SCALE,
    };
  });

/** One frame of the scene's route work: where is the boat, and what is visible. */
const runFrames = (frames: number) => {
  const track = windingRoute(5000, 8000, 12);
  const curve = createRouteCurve(track, SCENE_SCALE)!;
  const distances = getCurveDistances(curve);
  const curveLength = distances[distances.length - 1];
  const totalDistance = 8000;

  const chunkBounds = chunkProgressRanges(6).map((range) => {
    const geometry = createWaterChannelGeometry(curve, { range });
    return geometry.boundingSphere;
  });

  const position = new THREE.Vector3();
  const tangent = new THREE.Vector3();
  const camera = new THREE.Vector3();

  const started = performance.now();
  for (let frame = 0; frame < frames; frame++) {
    const metres = (frame / frames) * totalDistance;
    const progress = distanceToProgress(metres, totalDistance, distances, curveLength);
    getRoutePositionAtProgress(curve, progress, position, tangent);
    camera.copy(position).addScaledVector(tangent, -6);
    for (const bounds of chunkBounds) isChunkWithinViewDistance(bounds, camera);
  }
  return (performance.now() - started) / frames;
};

describe('per-frame route work on a 5,000-point winding route (#224)', () => {
  /**
   * A 60 fps frame is 16.7 ms and the scene must also physics-tick, animate and
   * draw in it. A millisecond is a generous ceiling for positioning the boat
   * and culling chunks, and roomy enough not to flake on a loaded machine.
   */
  const PER_FRAME_BUDGET_MS = 1;

  it('positions the boat and culls the chunks inside its budget', () => {
    runFrames(200); // warm the JIT and the curve's arc-length table
    expect(runFrames(600)).toBeLessThan(PER_FRAME_BUDGET_MS);
  });

  it('costs the same at the end of a route as at the start', () => {
    // A linear scan of the distance table would make late frames dearer than
    // early ones; the binary search in `distanceToProgress` must not.
    const track = windingRoute(5000, 8000, 12);
    const curve = createRouteCurve(track, SCENE_SCALE)!;
    const distances = getCurveDistances(curve);
    const curveLength = distances[distances.length - 1];
    const position = new THREE.Vector3();
    const tangent = new THREE.Vector3();

    const sampleAt = (progressBase: number) => {
      for (let i = 0; i < 2000; i++) {
        distanceToProgress(progressBase * 8000, 8000, distances, curveLength);
      }
      const started = performance.now();
      for (let i = 0; i < 20_000; i++) {
        const p = distanceToProgress(progressBase * 8000, 8000, distances, curveLength);
        getRoutePositionAtProgress(curve, p, position, tangent);
      }
      return performance.now() - started;
    };

    const early = sampleAt(0.02);
    const late = sampleAt(0.98);
    expect(late).toBeLessThan(early * 3 + 5);
  });

  it('allocates no vectors per frame', () => {
    const curve = createRouteCurve(windingRoute(1000, 3000, 6), SCENE_SCALE)!;
    const position = new THREE.Vector3();
    const tangent = new THREE.Vector3();

    const first = getRoutePositionAtProgress(curve, 0.1, position, tangent);
    const second = getRoutePositionAtProgress(curve, 0.9, position, tangent);

    expect(first.position).toBe(position);
    expect(second.position).toBe(position);
    expect(first.tangent).toBe(tangent);
  });
});
