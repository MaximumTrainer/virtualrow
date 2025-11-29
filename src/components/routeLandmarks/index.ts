// Route Landmarks Registry
// Central export point for all route-specific landmark configurations

export * from './types';

// Import individual route configurations
import { lakeBledDetector, lakeBledConfig } from './lakeBled';
import { bostonDetector, bostonConfig } from './boston';
import { londonDetector, londonConfig } from './london';
import { veniceDetector, veniceConfig } from './venice';
import { henleyDetector, henleyConfig } from './henley';

import type { RouteLandmarkConfig, RouteLandmarkRegistry } from './types';

// Export the landmark renderer component
export { LandmarkRenderer } from './LandmarkRenderer';
export { default as LandmarkRendererDefault } from './LandmarkRenderer';

// Registry of all route landmark configurations
export const routeLandmarkRegistry: RouteLandmarkRegistry = {
  'lake-bled': {
    detector: lakeBledDetector,
    config: lakeBledConfig
  },
  'charles-river-boston': {
    detector: bostonDetector,
    config: bostonConfig
  },
  'river-thames-london': {
    detector: londonDetector,
    config: londonConfig
  },
  'venice-grand-canal': {
    detector: veniceDetector,
    config: veniceConfig
  },
  'henley-regatta': {
    detector: henleyDetector,
    config: henleyConfig
  }
};

/**
 * Get the landmark configuration for a route based on its name and tags
 * @param routeName - The name of the route
 * @param routeTags - The tags associated with the route
 * @returns The landmark configuration if found, null otherwise
 */
export function getRouteLandmarkConfig(
  routeName: string | undefined, 
  routeTags: string[] | undefined
): RouteLandmarkConfig | null {
  const name = routeName || '';
  const tags = routeTags || [];
  
  for (const entry of Object.values(routeLandmarkRegistry)) {
    if (entry.detector(name, tags)) {
      return entry.config;
    }
  }
  
  return null;
}

/**
 * Check if a route has specific landmarks configured
 * @param routeName - The name of the route
 * @param routeTags - The tags associated with the route
 * @returns True if the route has landmark configuration
 */
export function hasRouteLandmarks(
  routeName: string | undefined, 
  routeTags: string[] | undefined
): boolean {
  return getRouteLandmarkConfig(routeName, routeTags) !== null;
}

// Re-export individual configs for direct access if needed
export { lakeBledConfig, lakeBledDetector } from './lakeBled';
export { bostonConfig, bostonDetector } from './boston';
export { londonConfig, londonDetector } from './london';
export { veniceConfig, veniceDetector } from './venice';
export { henleyConfig, henleyDetector } from './henley';
