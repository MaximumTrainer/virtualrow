import { describe, it, expect, afterEach } from 'vitest';
import * as THREE from 'three';
import {
  SCENERY_WATER_MARGIN_METRES,
  landClearance,
  nearestBankOffset,
  publishSceneryClearance,
  waterHalfWidthAt,
} from '../components/rower3d/sceneryClearance';
import { SHORELINE_WIDTH_METRES } from '../components/rower3d/bankGeometry';
import { SCENE_SCALE, WATER_CHANNEL_WIDTH } from '../components/rower3d/constants';
import { MIN_NAVIGABLE_WIDTH_METERS } from '../components/rower3d/navigableWidth';
import {
  getWaterWidthSceneUnitsForProgress,
  type RouteEnrichmentData,
} from '../services/routeEnrichmentService';

/**
 * Where the water ends, and how far past it scenery has to stand (#379).
 *
 * Every lateral offset in the scenery system was an absolute distance from the
 * centreline, authored against a narrow channel. On a 55 m river the half-width
 * is 27.5 m and a landmark at 7 m stood 20.5 m inside the water.
 */

const withWidths = (widths: number[], fallback = widths[0]): RouteEnrichmentData =>
  ({
    routeId: 'clearance',
    elevations: [],
    segmentProfiles: widths.map((waterWidthMeters, index) => ({
      index,
      startMeters: index * 50,
      endMeters: (index + 1) * 50,
      sceneryProfile: 'fallback',
      treeDensity: 0.5,
      vegetationDensity: 0.5,
      buildingDensity: 0.2,
      objectScale: 1,
      waterWidthMeters,
      dragMultiplier: 1,
      bearing: 0,
      bearingDelta: 0,
    })),
    waterBodyType: 'river',
    waterWidthMeters: fallback,
    waterColor: '#000',
    waveIntensity: 0.5,
    fetchedAt: 0,
    source: 'fallback',
  }) as RouteEnrichmentData;

describe('the scenery margin (#379 R2)', () => {
  it('is at least the shoreline strip, so nothing stands in the foam', () => {
    expect(SCENERY_WATER_MARGIN_METRES).toBeGreaterThanOrEqual(SHORELINE_WIDTH_METRES);
  });

  it('puts the nearest a placement may stand at the waterline plus the margin', () => {
    expect(nearestBankOffset(27.5)).toBeCloseTo(27.5 + SCENERY_WATER_MARGIN_METRES, 9);
  });
});

describe('waterHalfWidthAt — the width the water is built from', () => {
  it('reads a 55 m river as a 27.5 m half-width', () => {
    expect(waterHalfWidthAt(withWidths([55, 55, 55]), 0.5)).toBeCloseTo(27.5, 9);
  });

  it('agrees with the water channel at every progress, including between segments', () => {
    const enrichment = withWidths([20, 55, 120, 4], 30);

    for (let i = 0; i <= 20; i += 1) {
      const t = i / 20;
      expect(waterHalfWidthAt(enrichment, t)).toBeCloseTo(
        getWaterWidthSceneUnitsForProgress(enrichment.segmentProfiles, 30, t) / 2,
        9,
      );
    }
  });

  it('gives a route with no enrichment the default channel the water draws', () => {
    for (const none of [null, undefined]) {
      expect(waterHalfWidthAt(none, 0.3)).toBeCloseTo(WATER_CHANNEL_WIDTH / SCENE_SCALE / 2, 9);
    }
  });

  it('applies the navigable floor, as the water does', () => {
    expect(waterHalfWidthAt(withWidths([2, 2]), 0.5)).toBeCloseTo(
      MIN_NAVIGABLE_WIDTH_METERS / 2,
      9,
    );
  });
});

describe('landClearance — how far the nearest thing on the bank is from the water', () => {
  // A straight route along +z: the centreline is x = 0 and the perpendicular is x.
  const straight = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, 0, 100),
    new THREE.Vector3(0, 0, 200),
  ]);
  const river = withWidths([55, 55, 55]);

  it('measures the lateral distance past the waterline at each placement', () => {
    const reading = landClearance(
      [
        { position: [40, 0, 100], progress: 0.5 },
        { position: [-30, 0, 50], progress: 0.25 },
      ],
      straight,
      river,
    );

    expect(reading.count).toBe(2);
    expect(reading.nearestM).toBeCloseTo(2.5, 6);
    expect(reading.progress).toBeCloseTo(0.25, 9);
  });

  it('goes negative for something standing in the river', () => {
    const reading = landClearance([{ position: [7, 0, 100], progress: 0.5 }], straight, river);

    expect(reading.nearestM).toBeCloseTo(7 - 27.5, 6);
  });

  it('ignores how far along the route a placement is, only how far across', () => {
    // The GLB scatter is sampled at 0.999 when its progress says 1, so its
    // point is metres short of the one its progress names. That must not read
    // as clearance.
    const reading = landClearance([{ position: [30, 0, 199.8], progress: 1 }], straight, river);

    expect(reading.nearestM).toBeCloseTo(2.5, 3);
  });

  it('reads nothing measured as NaN rather than as a clearance', () => {
    const reading = landClearance([], straight, river);

    expect(reading.count).toBe(0);
    expect(reading.nearestM).toBeNaN();
  });
});

describe('publishSceneryClearance — what an E2E can read from the running scene', () => {
  afterEach(() => {
    delete window.__PLAYWRIGHT_TESTING;
    delete window.__ROWER3D_SCENERY_CLEARANCE;
  });

  const reading = { nearestM: 3, count: 4, progress: 0.2 };

  it('publishes nothing outside automation', () => {
    publishSceneryClearance('landscape', reading);

    expect(window.__ROWER3D_SCENERY_CLEARANCE).toBeUndefined();
  });

  it('files each placement path under its own name, with the margin it was held to', () => {
    window.__PLAYWRIGHT_TESTING = true;

    publishSceneryClearance('landscape', reading);
    publishSceneryClearance('structures', { ...reading, nearestM: 5 });

    expect(window.__ROWER3D_SCENERY_CLEARANCE).toEqual({
      landscape: { ...reading, marginM: SCENERY_WATER_MARGIN_METRES },
      structures: { ...reading, nearestM: 5, marginM: SCENERY_WATER_MARGIN_METRES },
    });
  });
});
