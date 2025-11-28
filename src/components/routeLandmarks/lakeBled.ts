// Lake Bled Circuit (Slovenia) landmark configuration
import type { RouteLandmarkConfig, RouteDetector } from './types';

export const lakeBledDetector: RouteDetector = (routeName, routeTags) => {
  return routeName?.toLowerCase().includes('bled') || routeTags?.includes('slovenia') || false;
};

export const lakeBledConfig: RouteLandmarkConfig = {
  routeId: 'lake-bled',
  routeType: 'lake',
  
  // Bled Castle - perched on a cliff on the north shore
  castle: {
    x: -50,
    z: -60,
    height: 12,
    width: 15,
    depth: 10,
    towers: [
      { x: -4, z: 0, height: 10, radius: 2, roofHeight: 4 },
      { x: 5, z: -2, height: 8, radius: 1.5, roofHeight: 3.5 }
    ]
  },
  
  // Bled Island with the Church of the Assumption
  island: {
    x: 0,
    z: -40,
    radius: 6,
    churchHeight: 8,
    stepsToChurch: true
  },
  
  // Julian Alps visible in the background
  mountains: [
    { x: -80, z: -120, scaleX: 30, scaleY: 25, rotation: 0, hasSnowCap: true },
    { x: 0, z: -140, scaleX: 35, scaleY: 30, rotation: 0.2, hasSnowCap: true },
    { x: 60, z: -130, scaleX: 28, scaleY: 22, rotation: -0.1, hasSnowCap: true }
  ]
};
