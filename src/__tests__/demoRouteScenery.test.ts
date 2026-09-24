import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { routeService } from '../services/routeService';
import {
  createFallbackRouteEnrichment,
  getWaterWidthSceneUnitsForProgress,
  type RouteEnrichmentData,
  type SceneryProfile,
} from '../services/routeEnrichmentService';
import { createRouteCurve } from '../components/rower3d/curve';
import { SCENE_SCALE } from '../components/rower3d/constants';
import { SCENERY_PROFILES } from '../components/rower3d/sceneryConfig';
import { resolveSceneryModels, type ResolvedScenery } from '../components/rower3d/sceneryAssets';
import { resolveRegion } from '../components/rower3d/sceneryRegion';
import {
  WILLOWBROOK_ROUTE_ID,
  getRouteSceneryTrack,
  trackWaterForProfile,
} from '../components/rower3d/sceneryTrack';
import { computePlacements, distinctProfiles } from '../components/rower3d/sceneryPlacement';
import { computeStructurePlacements, routeStructures } from '../components/rower3d/sceneryStructures';
import { layoutLandscape } from '../components/rower3d/landscapeLayout';
import { layoutFoliage } from '../components/rower3d/foliagePlan';
import { SCENE_CONFIG } from '../components/rower3d/themeConfig';
import { SCENERY_WATER_MARGIN_METRES } from '../components/rower3d/sceneryClearance';

/**
 * Issue #379, last acceptance scenario: the demo route has nothing standing in
 * its river.
 *
 * Every placement path the scene has - the GLB scatter on both banks, the
 * pinned course structures and the procedural landscape - laid out on the
 * bundled Willowbrook River exactly as Rower3D lays it out, and each placement
 * measured across the route against the water's half-width at its own
 * progress. The width is read here straight from
 * `getWaterWidthSceneUnitsForProgress`, not through the scenery's helper, so
 * the check does not share the code it is checking.
 */

const demo = routeService.getAllRoutes().find((r) => r.id === WILLOWBROOK_ROUTE_ID)!;
const curve = createRouteCurve(demo.coordinates, SCENE_SCALE)!;
const track = getRouteSceneryTrack(demo.id);
const region = resolveRegion(demo.coordinates);

/** The enrichment the demo gets offline: its tags make it a 45 m lake. */
const offline = createFallbackRouteEnrichment(demo);

/** The same route read as the 55 m river its name says it is. */
const asRiver: RouteEnrichmentData = {
  ...offline,
  waterBodyType: 'river',
  waterWidthMeters: 55,
  segmentProfiles: offline.segmentProfiles.map((s) => ({ ...s, waterWidthMeters: 55 })),
};

/** The same, with the width changing along the route, as a surveyed one does. */
const surveyed: RouteEnrichmentData = {
  ...offline,
  segmentProfiles: offline.segmentProfiles.map((s, i) => ({
    ...s,
    waterWidthMeters: [20, 55, 120, 80, 35][i % 5],
  })),
};

interface Measured {
  path: string;
  x: number;
  z: number;
  progress: number;
}

const everythingOnTheBank = (enrichment: RouteEnrichmentData): Measured[] => {
  // As SceneryModels resolves it.
  const resolvedByProfile = new Map<SceneryProfile, ResolvedScenery>();
  for (const p of distinctProfiles(enrichment, track)) {
    const water = track ? trackWaterForProfile(track, p) : enrichment.waterBodyType;
    resolvedByProfile.set(
      p,
      resolveSceneryModels(p, water, SCENERY_PROFILES[p]?.trees.species ?? [], region),
    );
  }

  const scatter = (['left', 'right'] as const).flatMap((side) =>
    computePlacements({ curve, enrichment, resolvedByProfile, budget: 1, side, track })
      .filter((p) => p.footing === 'bank')
      .map((p) => ({ path: `scenery-${side}`, x: p.position[0], z: p.position[2], progress: p.progress })),
  );

  const structures = computeStructurePlacements(
    curve,
    routeStructures({
      side: 'left',
      hasCurve: true,
      coordinates: demo.coordinates,
      crossings: enrichment.crossings,
    }),
    null,
    enrichment,
  )
    .filter((p) => p.footing === 'bank')
    .map((p) => ({ path: 'structures', x: p.position[0], z: p.position[2], progress: p.progress }));

  const { leftElements, rightElements } = layoutLandscape({ curve, enrichment, track });
  const landscape = [...leftElements, ...rightElements].map((e) => ({
    path: 'landscape',
    x: e.position.x,
    z: e.position.z,
    progress: e.progress,
  }));

  // The billboard trees, planted round the houses as CurvedLandscapeElements
  // plants them (#333).
  const avoid = [...leftElements, ...rightElements]
    .filter((e) => e.type === 'building')
    .map((e) => ({ x: e.position.x, z: e.position.z }));
  const foliage = layoutFoliage({ curve, enrichment, track, species: SCENE_CONFIG.trees.species, avoid }).map(
    (t) => ({ path: 'foliage', x: t.position[0], z: t.position[2], progress: t.progress }),
  );

  return [...scatter, ...structures, ...landscape, ...foliage];
};

/** Metres from the water's edge, across the route; negative is in the river. */
const clearanceOf = (enrichment: RouteEnrichmentData, { x, z, progress }: Measured) => {
  const t = Math.max(0, Math.min(1, progress));
  const centre = curve.getPointAt(t);
  const perp = new THREE.Vector3()
    .crossVectors(curve.getTangentAt(t).normalize(), new THREE.Vector3(0, 1, 0))
    .normalize();
  const across = Math.abs((x - centre.x) * perp.x + (z - centre.z) * perp.z);
  const halfWidth =
    getWaterWidthSceneUnitsForProgress(
      enrichment.segmentProfiles,
      enrichment.waterWidthMeters,
      progress,
    ) / 2;
  return across - halfWidth;
};

describe('the demo route has nothing standing in its river (#379)', () => {
  it.each([
    ['offline, as a 45 m lake', offline],
    ['as a 55 m river', asRiver],
    ['with a width that varies from 20 m to 120 m', surveyed],
  ])('%s', (_label, enrichment) => {
    const placed = everythingOnTheBank(enrichment);

    // Every path contributed, or this proved nothing about the one that did not.
    const paths = new Set(placed.map((p) => p.path));
    expect([...paths].sort()).toEqual([
      'foliage',
      'landscape',
      'scenery-left',
      'scenery-right',
      'structures',
    ]);
    // A tree-lined route, not the forty cone trees it had (#333).
    expect(placed.filter((p) => p.path === 'foliage').length).toBeGreaterThanOrEqual(400);

    const inTheRiver = placed
      .map((p) => ({ ...p, clearance: clearanceOf(enrichment, p) }))
      // The margin is held to within a centimetre: a placement on a bend is
      // offset at its own sample, and the curve is re-sampled here.
      .filter((p) => p.clearance < SCENERY_WATER_MARGIN_METRES - 0.01)
      .map((p) => `${p.path} at ${p.progress.toFixed(3)}: ${p.clearance.toFixed(2)} m`);

    expect(inTheRiver).toEqual([]);
  });

  it('was not already true before #379, so the check can fail', () => {
    // The landmark offset that stood a building 20.5 m into a 55 m river.
    const sevenMetresOut = { path: 'structures', x: 0, z: 0, progress: 0.5 };
    const centre = curve.getPointAt(0.5);
    const perp = new THREE.Vector3()
      .crossVectors(curve.getTangentAt(0.5).normalize(), new THREE.Vector3(0, 1, 0))
      .normalize();
    sevenMetresOut.x = centre.x + perp.x * 7;
    sevenMetresOut.z = centre.z + perp.z * 7;

    expect(clearanceOf(asRiver, sevenMetresOut)).toBeCloseTo(7 - 27.5, 6);
  });
});
