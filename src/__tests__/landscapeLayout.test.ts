import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  landscapeStanding,
  layoutLandscape,
  type LandscapeElement,
} from '../components/rower3d/landscapeLayout';
import { LANDSCAPE_OFFSET } from '../components/rower3d/constants';
import {
  SCENERY_WATER_MARGIN_METRES,
  landClearance,
} from '../components/rower3d/sceneryClearance';
import type { RouteEnrichmentData } from '../services/routeEnrichmentService';

/**
 * The procedural trees, buildings and mountains of `CurvedLandscapeElements`
 * (#379). `LANDSCAPE_OFFSET` put them 50 m from the centreline whatever the
 * water did, which is clear of a 55 m river and not of a 100 m one.
 */

const straight = new THREE.CatmullRomCurve3([
  new THREE.Vector3(0, 0, -600),
  new THREE.Vector3(0, 0, 0),
  new THREE.Vector3(0, 0, 600),
]);

const water = (widthMeters: number): RouteEnrichmentData =>
  ({
    routeId: 'landscape',
    elevations: [],
    segmentProfiles: [0, 1, 2, 3].map((index) => ({
      index,
      startMeters: index * 50,
      endMeters: (index + 1) * 50,
      sceneryProfile: 'forest',
      treeDensity: 0.7,
      vegetationDensity: 0.4,
      buildingDensity: 0.3,
      objectScale: 1,
      waterWidthMeters: widthMeters,
      dragMultiplier: 1,
      bearing: 0,
      bearingDelta: 0,
    })),
    waterBodyType: 'river',
    waterWidthMeters: widthMeters,
    waterColor: '#000',
    waveIntensity: 0.5,
    fetchedAt: 0,
    source: 'fallback',
  }) as RouteEnrichmentData;

const everything = (e: RouteEnrichmentData | null, curve = straight): LandscapeElement[] => {
  const { leftElements, rightElements } = layoutLandscape({ curve, enrichment: e });
  return [...leftElements, ...rightElements];
};

const standing = (elements: LandscapeElement[]) =>
  landscapeStanding({ leftElements: elements, rightElements: [] });

const offsets = (elements: LandscapeElement[]) => elements.map((e) => Math.abs(e.position.x));

describe('layoutLandscape', () => {
  it('dresses both banks along the whole route', () => {
    const { leftElements, rightElements } = layoutLandscape({ curve: straight, enrichment: water(55) });

    expect(leftElements.length).toBeGreaterThan(5);
    expect(rightElements.length).toBeGreaterThan(5);
    // Opposite banks: every left element on one side of the line, every right
    // one on the other.
    const leftSide = Math.sign(leftElements[0].position.x);
    expect(leftElements.every((e) => Math.sign(e.position.x) === leftSide)).toBe(true);
    expect(rightElements.every((e) => Math.sign(e.position.x) === -leftSide)).toBe(true);
    const progress = [...leftElements, ...rightElements].map((e) => e.progress);
    expect(Math.min(...progress)).toBeLessThan(0.1);
    expect(Math.max(...progress)).toBeGreaterThan(0.9);
  });

  it('is deterministic, so a route looks the same on every visit', () => {
    expect(layoutLandscape({ curve: straight, enrichment: water(55) })).toEqual(
      layoutLandscape({ curve: straight, enrichment: water(55) }),
    );
  });

  it('keeps the 50 m it always stood back where the water allows it', () => {
    for (const e of [null, water(20), water(55)]) {
      const across = offsets(everything(e));
      expect(Math.min(...across)).toBeGreaterThanOrEqual(LANDSCAPE_OFFSET);
      expect(Math.max(...across)).toBeLessThanOrEqual(LANDSCAPE_OFFSET + 50);
    }
  });

  it('keeps out of a 120 m river, which is wider than 50 m allows', () => {
    const elements = everything(water(120));
    const reading = landClearance(standing(elements), straight, water(120));

    expect(reading.count).toBeGreaterThan(10);
    expect(reading.nearestM).toBeGreaterThanOrEqual(SCENERY_WATER_MARGIN_METRES - 1e-6);
  });

  it('moves out rather than piling up on the bank', () => {
    // The spread behind the floor is kept, so wide water thins the landscape
    // with distance instead of lining it all up at the waterline.
    const across = offsets(everything(water(120)));

    expect(Math.max(...across) - Math.min(...across)).toBeGreaterThan(10);
  });

  it('keeps out of the water on a bend as well', () => {
    const bend = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0, -600),
      new THREE.Vector3(200, 0, 0),
      new THREE.Vector3(0, 0, 600),
    ]);

    const reading = landClearance(standing(everything(water(120), bend)), bend, water(120));

    expect(reading.nearestM).toBeGreaterThanOrEqual(SCENERY_WATER_MARGIN_METRES - 1e-6);
  });

  it('places nothing without a curve', () => {
    expect(layoutLandscape({ curve: null, enrichment: water(55) })).toEqual({
      leftElements: [],
      rightElements: [],
    });
  });
});
