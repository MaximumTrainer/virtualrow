import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { BANK_WATERLINE_Y, createBankGeometry } from '../components/rower3d/bankGeometry';
import { stripSegmentCount } from '../components/rower3d/routeStripGeometry';
import {
  MAX_TERRAIN_RELIEF_SCENE_UNITS,
  type RouteEnrichmentData,
} from '../services/routeEnrichmentService';

/**
 * Proves the OpenTopoData elevations reach the geometry the rower actually
 * sees (#202). Before this, `elevations` was fetched on every cache miss and
 * read by nothing, so a flat canal and an alpine course drew identical banks.
 */

const straightCurve = () =>
  new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, 0, -50),
    new THREE.Vector3(0, 0, -100),
    new THREE.Vector3(0, 0, -150),
  ]);

const enrichmentWith = (elevations: number[]): RouteEnrichmentData => ({
  routeId: 'terrain-fixture',
  elevations,
  segmentProfiles: [],
  waterBodyType: 'river',
  waterWidthMeters: 20,
  waterColor: '#3a6b7d',
  waveIntensity: 1,
  fetchedAt: Date.now(),
  source: 'network',
});

/** Outer-edge vertices are the odd ones; each segment pushes inner then outer. */
const outerHeights = (geometry: THREE.BufferGeometry): number[] => {
  const position = geometry.getAttribute('position');
  const heights: number[] = [];
  for (let i = 1; i < position.count; i += 2) {
    heights.push(position.getY(i));
  }
  return heights;
};

const innerHeights = (geometry: THREE.BufferGeometry): number[] => {
  const position = geometry.getAttribute('position');
  const heights: number[] = [];
  for (let i = 0; i < position.count; i += 2) {
    heights.push(position.getY(i));
  }
  return heights;
};

describe('riverbank terrain relief (#202)', () => {
  it('draws a flat bank when there is no enrichment at all', () => {
    const geometry = createBankGeometry(straightCurve(), 'left');

    expect(outerHeights(geometry).every((y) => y === BANK_WATERLINE_Y)).toBe(true);
    geometry.dispose();
  });

  it('draws a flat bank for the all-zero elevations the fallback produces', () => {
    // createFallbackRouteEnrichment fills elevations with zeros. A route that
    // never reached OpenTopoData must render exactly as it did before.
    const geometry = createBankGeometry(straightCurve(), 'left', { enrichment: enrichmentWith([0, 0, 0, 0]) });

    expect(outerHeights(geometry).every((y) => y === BANK_WATERLINE_Y)).toBe(true);
    geometry.dispose();
  });

  it('raises the bank where the real terrain climbs', () => {
    const geometry = createBankGeometry(
      straightCurve(),
      'left',
      { enrichment: enrichmentWith([0, 50, 100, 150]) },
    );
    const heights = outerHeights(geometry);

    expect(heights[0]).toBeCloseTo(BANK_WATERLINE_Y, 6);
    expect(heights[heights.length - 1]).toBeGreaterThan(BANK_WATERLINE_Y);
    // A monotonic climb upstream should produce a monotonic bank.
    for (let i = 1; i < heights.length; i++) {
      expect(heights[i]).toBeGreaterThanOrEqual(heights[i - 1] - 1e-6);
    }
    geometry.dispose();
  });

  it('keeps the inner edge on the waterline however steep the terrain', () => {
    // Anything else opens a gap between the bank and the water plane.
    const geometry = createBankGeometry(
      straightCurve(),
      'right',
      { enrichment: enrichmentWith([0, 400, 900, 1500]) },
    );

    expect(innerHeights(geometry).every((y) => y === BANK_WATERLINE_Y)).toBe(true);
    geometry.dispose();
  });

  it('clamps an extreme course so the bank cannot wall the rower in', () => {
    const geometry = createBankGeometry(
      straightCurve(),
      'left',
      { enrichment: enrichmentWith([0, 100000, 200000, 300000]) },
    );
    const ceiling = BANK_WATERLINE_Y + MAX_TERRAIN_RELIEF_SCENE_UNITS;

    expect(Math.max(...outerHeights(geometry))).toBeLessThanOrEqual(ceiling + 1e-6);
    geometry.dispose();
  });

  it('emits finite positions and normals for every vertex', () => {
    // A NaN anywhere in the buffer silently blanks the mesh at runtime.
    const geometry = createBankGeometry(
      straightCurve(),
      'left',
      { enrichment: enrichmentWith([12, Number.NaN, 80, 45]) },
    );

    const position = geometry.getAttribute('position');
    const normal = geometry.getAttribute('normal');

    expect(position.count).toBe((stripSegmentCount(straightCurve()) + 1) * 2);
    expect(normal).toBeDefined();
    for (let i = 0; i < position.count; i++) {
      expect(Number.isFinite(position.getX(i))).toBe(true);
      expect(Number.isFinite(position.getY(i))).toBe(true);
      expect(Number.isFinite(position.getZ(i))).toBe(true);
      expect(Number.isFinite(normal.getX(i))).toBe(true);
      expect(Number.isFinite(normal.getY(i))).toBe(true);
      expect(Number.isFinite(normal.getZ(i))).toBe(true);
    }
    geometry.dispose();
  });

  it('computes normals that tilt with the slope instead of pointing straight up', () => {
    const flat = createBankGeometry(straightCurve(), 'left', { enrichment: enrichmentWith([0, 0, 0, 0]) });
    const sloped = createBankGeometry(straightCurve(), 'left', { enrichment: enrichmentWith([0, 60, 120, 180]) });

    const flatNormal = flat.getAttribute('normal');
    const slopedNormal = sloped.getAttribute('normal');

    // Sample a mid-strip vertex: flat stays vertical, sloped does not.
    const sample = 100;
    expect(Math.abs(flatNormal.getY(sample))).toBeCloseTo(1, 5);
    expect(Math.abs(slopedNormal.getY(sample))).toBeLessThan(1);

    flat.dispose();
    sloped.dispose();
  });
});
