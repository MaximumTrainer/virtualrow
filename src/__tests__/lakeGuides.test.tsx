import { render } from '@testing-library/react';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { RiverGuides } from '../components/rower3d/RiverGuides';
import { buildLakeGuides } from '../components/rower3d/riverGuideGeometry';
import { waterDetectionTelemetry, type RouteEnrichmentData } from '../lib/services/routeEnrichmentService';
import type { Coordinate } from '../lib/types/index';
import type { LakePolygon } from '../lib/utils/lakePolygons';

/**
 * #493 FR22 / AC23: the debug guides draw the lake's detected shoreline and
 * its islands, and the telemetry log carries what detection found.
 */

const M = 1 / 111_320;
const origin: Coordinate = { lat: 0, lng: 0 };
const at = (x: number, y: number): Coordinate => ({ lat: y * M, lng: x * M });
const square = (x0: number, y0: number, x1: number, y1: number) => [at(x0, y0), at(x1, y0), at(x1, y1), at(x0, y1), at(x0, y0)];
const lake: LakePolygon = {
  featureId: 'way/1',
  outer: square(-200, -200, 200, 200),
  inner: [square(80, 80, 120, 120), square(-120, -120, -80, -80)],
};

const enrichment = (overrides: Partial<RouteEnrichmentData> = {}): RouteEnrichmentData => ({
  routeId: 'lake-guides',
  elevations: [],
  segmentProfiles: [],
  waterBodyType: 'lake',
  waterWidthMeters: 120,
  waterColor: '#335577',
  waveIntensity: 0.3,
  fetchedAt: 0,
  source: 'network',
  ...overrides,
});

describe('#493 AC23 lake guides', () => {
  it('traces each shoreline and island as a closed loop above the water', () => {
    const { shores, islands } = buildLakeGuides([lake], origin);
    expect(shores).toHaveLength(1);
    expect(islands).toHaveLength(2);
    for (const loop of [...shores, ...islands]) {
      expect(loop[0].distanceTo(loop[loop.length - 1])).toBeLessThan(1e-6);
      expect(loop.every((point) => point.y > 0)).toBe(true);
    }
    // East on +x, north on -z, like the route curve.
    expect(Math.max(...shores[0].map((p) => p.x))).toBeCloseTo(200, 0);
    expect(Math.min(...islands[0].map((p) => p.z))).toBeCloseTo(-120, 0);
  });

  it('draws nothing without a lake', () => {
    expect(buildLakeGuides(undefined, origin)).toEqual({ shores: [], islands: [] });
    expect(buildLakeGuides([lake], null)).toEqual({ shores: [], islands: [] });
  });

  it('adds a line per shoreline and island to the channel guides', () => {
    const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0, -100), new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, 100)]);
    const { container } = render(
      <RiverGuides curve={curve} origin={origin} enrichment={enrichment({ lakes: { polygons: [lake], elevationMeters: 0 } })} />,
    );
    expect(container.querySelectorAll('primitive').length).toBe(3 + 1 + 2);
  });
});

describe('#493 FR22 detection summary in the telemetry log', () => {
  it('reports the type, the sample counts, and the lakes and islands drawn', () => {
    const detail = waterDetectionTelemetry(
      enrichment({
        waterDetection: { shares: { lake: 0.9, river: 0.1 }, water: 40, land: 1, unknown: 2 },
        lakes: { polygons: [lake], elevationMeters: 12 },
      }),
    );
    expect(detail).toEqual({
      waterBodyType: 'lake',
      source: 'network',
      shares: { lake: 0.9, river: 0.1 },
      water: 40,
      land: 1,
      unknown: 2,
      lakes: 1,
      islands: 2,
    });
  });

  it('reports nothing for fallback data, which has no detection', () => {
    expect(waterDetectionTelemetry(enrichment({ source: 'fallback' }))).toBeNull();
    expect(waterDetectionTelemetry(null)).toBeNull();
  });
});
