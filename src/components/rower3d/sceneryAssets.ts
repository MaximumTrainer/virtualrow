// ============================================================================
// SCENERY ASSET SELECTION — maps the enrichment enums to the llm-cad GLB kit
//
// The scenery model catalogue (issue #216) lives in
// public/assets/scenery/tier-<a..f>/<id>.glb.  Every model was authored to two
// enums the route enrichment service already produces:
//
//   SceneryProfile  — forest | residential | commercial | farmland | beach |
//                     wetland | fallback   (per 50 m segment)
//   WaterBodyType   — river | canal | stream | lake | reservoir | unknown
//                     (per route)
//
// This module encodes the issue's "selection matrix" so the scene can pick the
// right generic-biome (Tier F) and vegetation (Tier E) models for a given
// segment without any new classification layer.  It is deliberately pure and
// data-only so it can be unit-tested and reused by any renderer.
// ============================================================================

import type {
  SceneryProfile,
  WaterBodyType,
} from '../../services/routeEnrichmentService';
import type { SceneryRegion } from './sceneryRegion';

/** A scenery model id, e.g. `f01-bank-earth-cut` or `e04-english-oak`. */
export type SceneryModelId = string;

/**
 * Resolve the public URL of a model's GLB.  The tier folder is derived from the
 * id's first character (a/b/c/d/e/f), matching the on-disk layout produced by
 * scripts/build_scenery.py.
 */
export const sceneryAssetPath = (id: SceneryModelId): string =>
  `/assets/scenery/tier-${id[0]}/${id}.glb`;

// ---------------------------------------------------------------------------
// Tier F — generic biome kit, keyed to SceneryProfile (F1 bank edge, F2
// landform, F3 scatter, F6 backdrop).  Straight from the issue selection matrix.
// ---------------------------------------------------------------------------
export interface ProfileModelSet {
  bankEdge: SceneryModelId[];
  landform: SceneryModelId[];
  scatter: SceneryModelId[];
  backdrop: SceneryModelId[];
}

export const SCENERY_PROFILE_MODELS: Record<SceneryProfile, ProfileModelSet> = {
  forest: {
    bankEdge: ['f01-bank-earth-cut', 'f02-bank-shingle-shelf', 'f08-bank-pile-revetment'],
    landform: ['f11-hillside-wooded', 'f12-bluff-steep'],
    scatter: ['f21-boulder-cluster', 'f23-driftwood-log', 'f24-deadfall-branch-pile', 'f25-bramble-scrub', 'f26-fern-clump'],
    backdrop: ['f45-treeline-strip', 'f46-hill-ridge-far'],
  },
  farmland: {
    bankEdge: ['f01-bank-earth-cut', 'f03-bank-reed-margin', 'f08-bank-pile-revetment'],
    landform: ['f10-ridge-rolling-meadow', 'f14-polder-flat'],
    scatter: ['f18-grass-tuft-clump', 'f19-flower-meadow-patch', 'f25-bramble-scrub'],
    backdrop: ['f45-treeline-strip', 'f46-hill-ridge-far'],
  },
  residential: {
    bankEdge: ['f04-bank-masonry-wall', 'f08-bank-pile-revetment', 'f09-bank-concrete-step'],
    landform: ['f10-ridge-rolling-meadow'],
    scatter: ['f18-grass-tuft-clump', 'f19-flower-meadow-patch', 'f21-boulder-cluster'],
    backdrop: ['f47-skyline-strip'],
  },
  commercial: {
    bankEdge: ['f04-bank-masonry-wall', 'f05-bank-sheet-piling', 'f09-bank-concrete-step'],
    landform: [],
    scatter: ['f21-boulder-cluster', 'f22-shingle-scatter'],
    backdrop: ['f47-skyline-strip'],
  },
  wetland: {
    bankEdge: ['f03-bank-reed-margin', 'f08-bank-pile-revetment'],
    landform: ['f14-polder-flat', 'f17-mudflat-tidal'],
    scatter: ['f20-reed-stand', 'f24-deadfall-branch-pile'],
    backdrop: ['f45-treeline-strip'],
  },
  beach: {
    bankEdge: ['f06-bank-sand-shelf', 'f07-bank-boulder-shore'],
    landform: ['f13-cliff-face', 'f17-mudflat-tidal'],
    scatter: ['f22-shingle-scatter', 'f23-driftwood-log'],
    backdrop: ['f46-hill-ridge-far'],
  },
  fallback: {
    bankEdge: ['f01-bank-earth-cut', 'f02-bank-shingle-shelf'],
    landform: ['f10-ridge-rolling-meadow', 'f12-bluff-steep'],
    scatter: ['f18-grass-tuft-clump', 'f21-boulder-cluster', 'f25-bramble-scrub'],
    backdrop: ['f45-treeline-strip', 'f46-hill-ridge-far'],
  },
};

// ---------------------------------------------------------------------------
// Tier F — keyed to WaterBodyType (F1 bank edge, F2 in-water, F4 surface).
// ---------------------------------------------------------------------------
export interface WaterModelSet {
  bankEdge: SceneryModelId[];
  inWater: SceneryModelId[];
  surface: SceneryModelId[];
}

export const WATER_BODY_MODELS: Record<WaterBodyType, WaterModelSet> = {
  river: {
    bankEdge: ['f01-bank-earth-cut', 'f04-bank-masonry-wall', 'f08-bank-pile-revetment', 'f17-mudflat-tidal'],
    inWater: ['f15-sandbank-midchannel', 'f16-island-wooded'],
    surface: ['f29-weed-streamer', 'f30-foam-line', 'f31-moored-dinghy', 'f32-moored-cruiser'],
  },
  stream: {
    bankEdge: ['f01-bank-earth-cut', 'f02-bank-shingle-shelf'],
    inWater: ['f15-sandbank-midchannel'],
    surface: ['f29-weed-streamer', 'f30-foam-line', 'f31-moored-dinghy'],
  },
  canal: {
    bankEdge: ['f03-bank-reed-margin', 'f04-bank-masonry-wall', 'f05-bank-sheet-piling', 'f08-bank-pile-revetment'],
    inWater: [],
    surface: ['f27-lily-pad-raft', 'f28-floating-weed-mat', 'f31-moored-dinghy', 'f32-moored-cruiser', 'f43-mooring-bollard', 'f44-navigation-marker'],
  },
  lake: {
    bankEdge: ['f02-bank-shingle-shelf', 'f03-bank-reed-margin', 'f06-bank-sand-shelf', 'f07-bank-boulder-shore'],
    inWater: ['f16-island-wooded'],
    surface: ['f27-lily-pad-raft', 'f28-floating-weed-mat', 'f31-moored-dinghy', 'f32-moored-cruiser'],
  },
  reservoir: {
    bankEdge: ['f05-bank-sheet-piling', 'f09-bank-concrete-step'],
    inWater: [],
    surface: ['f28-floating-weed-mat', 'f30-foam-line', 'f44-navigation-marker'],
  },
  unknown: {
    bankEdge: ['f01-bank-earth-cut', 'f02-bank-shingle-shelf'],
    inWater: [],
    surface: ['f31-moored-dinghy'],
  },
};

// ---------------------------------------------------------------------------
// Tier E — vegetation.  sceneryConfig already maps each profile to a set of
// tree "species" strings; this maps each of those strings to the matching Tier E
// GLB, so the tree species logic drives which model is planted.
// ---------------------------------------------------------------------------
export const TREE_SPECIES_MODELS: Record<string, SceneryModelId[]> = {
  pine: ['e07-eastern-white-pine', 'e08-scots-pine'],
  oak: ['e04-english-oak'],
  willow: ['e02-weeping-willow', 'e12-pollarded-willow'],
  cypress: ['e10-italian-cypress'],
  ornamental: ['e01-london-plane', 'e03-lombardy-poplar'],
  // No palm model in Tier E; the columnar cypress is the nearest warm-climate stand-in.
  palm: ['e10-italian-cypress'],
  bare: ['e09-alder-scrub', 'e12-pollarded-willow'],
};

// ---------------------------------------------------------------------------
// Universal rowing furniture (Tier A) placed on every course regardless of
// biome — the small repeated props that read as "a rowing course".
// ---------------------------------------------------------------------------
export const UNIVERSAL_FURNITURE: SceneryModelId[] = [
  'a01-buoy-lane-sphere',
  'a07-distance-marker-post',
  'a11-bank-railing',
  'a12-regatta-flagpole',
];

// ---------------------------------------------------------------------------
// Tier D — regional building kits, keyed to the route's region.
//
// These 25 models shipped with #216 but nothing could reach them: selection had
// no geography to go on. `builtUp` dresses towns and industry, `rural` dresses
// farmland, and a region may add its own bank edge (issue #232).
// ---------------------------------------------------------------------------
export interface RegionalModelSet {
  /** Town and industrial buildings, for residential and commercial stretches. */
  builtUp: SceneryModelId[];
  /** Farm and water-management buildings, for farmland stretches. */
  rural: SceneryModelId[];
  /** Bank treatment characteristic of the region. */
  bankEdge: SceneryModelId[];
}

export const REGIONAL_MODELS: Record<SceneryRegion, RegionalModelSet> = {
  gb: {
    builtUp: ['d-gb-01-terrace-brick', 'd-gb-02-church-square-tower', 'd-gb-03-riverside-pub'],
    rural: ['d-gb-04-stone-cottage', 'd-gb-05-stone-barn', 'd-gb-06-regatta-marquee'],
    bankEdge: [],
  },
  ce: {
    builtUp: ['d-ce-01-baroque-church-onion', 'd-ce-02-panelak-block', 'd-ce-03-riverside-villa'],
    rural: ['d-ce-04-hydro-weir-house'],
    bankEdge: [],
  },
  it: {
    builtUp: ['d-it-01-po-palazzo', 'd-it-02-castello-valentino'],
    rural: [],
    bankEdge: ['d-it-03-arcaded-embankment'],
  },
  nl: {
    builtUp: ['d-nl-01-gabled-canal-house', 'd-nl-04-canal-lock'],
    rural: ['d-nl-02-polder-windmill', 'd-nl-03-polder-farmhouse', 'd-nl-05-wind-turbine'],
    bankEdge: ['d-nl-06-reed-bank-edge'],
  },
  us: {
    builtUp: [
      'd-us-01-clapboard-house',
      'd-us-02-brick-mill',
      'd-us-03-collegiate-dome',
      'd-us-04-collegiate-tower',
      'd-us-05-water-tower',
      'd-us-06-highway-sign-gantry',
    ],
    rural: [],
    bankEdge: [],
  },
};

/** Which regional kit, if any, dresses a profile. Wild stretches stay unbuilt. */
const REGIONAL_KIT_FOR_PROFILE: Partial<Record<SceneryProfile, keyof RegionalModelSet>> = {
  residential: 'builtUp',
  commercial: 'builtUp',
  farmland: 'rural',
};

export interface ResolvedScenery {
  /** Bank-edge strip models (both profile- and water-derived), de-duplicated. */
  bankEdge: SceneryModelId[];
  /** Landform masses behind the bank. */
  landform: SceneryModelId[];
  /** Ground scatter that dresses the bank. */
  scatter: SceneryModelId[];
  /** Distant silhouette backdrop. */
  backdrop: SceneryModelId[];
  /** Models that sit in the water channel. */
  inWater: SceneryModelId[];
  /** Models that float on the water surface. */
  surface: SceneryModelId[];
  /** Tier E tree models for the profile's allowed species. */
  trees: SceneryModelId[];
  /** Universal Tier A rowing furniture. */
  furniture: SceneryModelId[];
  /** Tier D regional buildings; empty off-kit or on a wild stretch. */
  buildings: SceneryModelId[];
}

const uniq = (ids: SceneryModelId[]): SceneryModelId[] => Array.from(new Set(ids));

/**
 * Resolve the full set of scenery models for a segment, given its scenery
 * profile and the route's water-body type.  `treeSpecies` is the profile's
 * allowed species list (from SCENERY_PROFILES) so vegetation stays consistent
 * with the procedural tree selection.
 */
export const resolveSceneryModels = (
  profile: SceneryProfile,
  waterType: WaterBodyType,
  treeSpecies: string[] = [],
  region?: SceneryRegion | null,
): ResolvedScenery => {
  const p = SCENERY_PROFILE_MODELS[profile] ?? SCENERY_PROFILE_MODELS.fallback;
  const w = WATER_BODY_MODELS[waterType] ?? WATER_BODY_MODELS.unknown;
  const trees = uniq(
    treeSpecies.flatMap((sp) => TREE_SPECIES_MODELS[sp] ?? []),
  );
  const regional = region ? REGIONAL_MODELS[region] : undefined;
  const kit = REGIONAL_KIT_FOR_PROFILE[profile];
  return {
    bankEdge: uniq([...p.bankEdge, ...w.bankEdge, ...(regional?.bankEdge ?? [])]),
    landform: uniq(p.landform),
    scatter: uniq(p.scatter),
    backdrop: uniq(p.backdrop),
    inWater: uniq(w.inWater),
    surface: uniq(w.surface),
    trees,
    furniture: UNIVERSAL_FURNITURE,
    buildings: regional && kit ? uniq(regional[kit]) : [],
  };
};

/**
 * Whether the GLB scenery kit renders.
 *
 * It was opt-in while its cost was unvalidated. That gate also carried
 * `!IS_TEST_MODE` at both call sites, which made the kit exempt from automation
 * by construction — the same trap #197 fixed for postprocessing, where the test
 * flag decided both "are we in a test" and "which effects run". The two
 * questions are separated here: an explicit answer always wins, in either
 * direction, and only the default differs between a rower and a spec.
 *
 * `?glb=0` turns it off again without a deploy.
 */
export const isGlbSceneryEnabled = (): boolean => {
  if (typeof window === 'undefined') return false;
  const w = window as unknown as {
    __VIRTUALROW_SCENERY_MODELS?: boolean;
    __PLAYWRIGHT_TESTING?: boolean;
  };
  if (typeof w.__VIRTUALROW_SCENERY_MODELS === 'boolean') return w.__VIRTUALROW_SCENERY_MODELS;

  try {
    const requested = new URLSearchParams(window.location.search).get('glb');
    if (requested === '1') return true;
    if (requested === '0') return false;
  } catch {
    // No usable location; fall through to the default.
  }

  // Automation opts in per spec, so suites that do not measure the kit do not
  // pay for it.
  return !w.__PLAYWRIGHT_TESTING;
};

/** Flat, de-duplicated list of every GLB a resolved set needs — for preloading. */
export const collectSceneryPaths = (resolved: ResolvedScenery): string[] =>
  uniq([
    ...resolved.bankEdge,
    ...resolved.landform,
    ...resolved.scatter,
    ...resolved.backdrop,
    ...resolved.inWater,
    ...resolved.surface,
    ...resolved.trees,
    ...resolved.furniture,
    ...resolved.buildings,
  ]).map(sceneryAssetPath);
