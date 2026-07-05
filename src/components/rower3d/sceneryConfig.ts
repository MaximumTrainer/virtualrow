// ============================================================================
// SCENERY PROFILE CONFIG — data-driven visual parameters per OSM scenery profile
//
// Provides the rendering-layer complement to SCENERY_PROFILE_CONFIG in
// routeEnrichmentService.ts.  While the enrichment service stores abstract
// density numbers used for element-placement logic, this module exposes the
// concrete visual properties consumed by vegetationComponents and
// bankComponents when selecting species, scaling trees, filtering ground cover,
// and sizing buildings.
// ============================================================================

import type { SceneryProfile } from '../../services/routeEnrichmentService';

export interface SceneryProfileConfig {
  trees: {
    /**
     * Relative density 0–1.  Scales the number of tree clusters placed per
     * scene unit (1.0 = maximum / dense forest density).
     */
    density: number;
    /**
     * Allowed species types.  Matched against TreeSpeciesEntry.type from
     * themeConfig so that forest routes prefer pines/oaks and beach routes
     * prefer palms.  When none of the theme's species match, all species are
     * used as a fallback.
     */
    species: string[];
    /** [min, max] scale multiplier applied to each tree instance. */
    scaleRange: [number, number];
  };
  groundCover: {
    /** Relative density 0–1.  Scales instance counts for reeds, rocks, etc. */
    density: number;
    /**
     * Ground cover types to show.  Matched against GroundCoverTypeEntry.type
     * from themeConfig.  Types not listed here are hidden for this profile.
     */
    types: string[];
  };
  buildings: {
    /**
     * Probability 0–1 that a landscape slot becomes a building rather than a
     * tree or mountain.  Kept in sync with buildingDensity in
     * SCENERY_PROFILE_CONFIG for consistency.
     */
    probability: number;
    /**
     * [min, max] height multiplier applied to building box geometry.
     * A value of 1.0 = the baseline 12.5 scene-unit height.
     */
    heightRange: [number, number];
  };
}

export const SCENERY_PROFILES: Record<SceneryProfile, SceneryProfileConfig> = {
  forest: {
    trees: {
      density: 1.0,
      species: ['pine', 'oak', 'willow', 'cypress'],
      scaleRange: [0.85, 1.4],
    },
    groundCover: {
      density: 0.85,
      types: ['rock', 'grass', 'reed'],
    },
    buildings: {
      probability: 0.05,
      heightRange: [0.5, 0.8],
    },
  },

  residential: {
    trees: {
      density: 0.55,
      species: ['oak', 'willow', 'ornamental'],
      scaleRange: [0.7, 1.1],
    },
    groundCover: {
      density: 0.55,
      types: ['grass', 'flower'],
    },
    buildings: {
      probability: 0.4,
      heightRange: [0.8, 1.2],
    },
  },

  commercial: {
    trees: {
      density: 0.15,
      species: ['ornamental'],
      scaleRange: [0.6, 0.9],
    },
    groundCover: {
      density: 0.2,
      types: ['debris', 'rock'],
    },
    buildings: {
      probability: 0.8,
      heightRange: [1.0, 2.0],
    },
  },

  farmland: {
    trees: {
      density: 0.22,
      species: ['oak', 'willow', 'bare'],
      scaleRange: [0.7, 1.0],
    },
    groundCover: {
      density: 0.45,
      types: ['grass', 'flower', 'reed'],
    },
    buildings: {
      probability: 0.08,
      heightRange: [0.6, 0.9],
    },
  },

  beach: {
    trees: {
      density: 0.18,
      species: ['palm', 'ornamental'],
      scaleRange: [0.6, 1.0],
    },
    groundCover: {
      density: 0.35,
      types: ['reed', 'grass'],
    },
    buildings: {
      probability: 0.04,
      heightRange: [0.5, 0.7],
    },
  },

  wetland: {
    trees: {
      density: 0.3,
      species: ['willow', 'bare'],
      scaleRange: [0.65, 1.0],
    },
    groundCover: {
      density: 0.8,
      types: ['reed', 'grass', 'rock'],
    },
    buildings: {
      probability: 0.03,
      heightRange: [0.4, 0.6],
    },
  },

  fallback: {
    trees: {
      density: 0.45,
      species: ['pine', 'oak', 'willow'],
      scaleRange: [0.7, 1.1],
    },
    groundCover: {
      density: 0.5,
      types: ['grass', 'reed', 'rock'],
    },
    buildings: {
      probability: 0.1,
      heightRange: [0.7, 1.0],
    },
  },
};
