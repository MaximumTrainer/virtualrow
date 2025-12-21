// Lake Bled Circuit (Slovenia) - "Crystal Sanctum of Bled" Fantasy Configuration
// Theme: Ethereal floating crystal towers, bioluminescent waters, ancient elven sanctuaries
// The lake shimmers with an otherworldly cyan glow, ancient crystal spires pierce the aurora-lit sky
import type { RouteLandmarkConfig, RouteDetector } from './types';

export const lakeBledDetector: RouteDetector = (routeName, routeTags) => {
  return routeName?.toLowerCase().includes('bled') || 
         routeName?.toLowerCase().includes('crystal') ||
         routeName?.toLowerCase().includes('sanctum') ||
         routeTags?.includes('slovenia') || 
         routeTags?.includes('fantasy') ||
         false;
};

export const lakeBledConfig: RouteLandmarkConfig = {
  routeId: 'lake-bled',
  routeType: 'lake',
  
  // Ancient Elven Crystal Citadel - replaces Bled Castle
  // Floating spires of translucent crystal atop the cliff
  castle: {
    x: -50,
    z: -60,
    height: 18, // Taller, more ethereal
    width: 12,
    depth: 8,
    towers: [
      // Crystal spires with glowing tips
      { x: -6, z: 0, height: 16, radius: 1.5, roofHeight: 8 }, // Tall crystal spire
      { x: 0, z: -3, height: 22, radius: 2, roofHeight: 10 },  // Main crystal tower
      { x: 6, z: 1, height: 14, radius: 1.2, roofHeight: 7 },  // Secondary spire
      { x: -3, z: 4, height: 12, radius: 1, roofHeight: 6 }    // Tertiary spire
    ]
  },
  
  // Sacred Isle of the Elven Temple - replaces Church of Assumption
  // Ancient sanctuary with glowing runes, surrounded by bioluminescent waters
  island: {
    x: 0,
    z: -40,
    radius: 8, // Larger mystical island
    churchHeight: 12, // Taller elven temple
    stepsToChurch: true // Crystal stairway emerges from the waters
  },
  
  // The Crystalline Peaks - Julian Alps transformed
  // Mountains with glowing crystal veins, aurora reflections on snow
  mountains: [
    { x: -80, z: -120, scaleX: 35, scaleY: 32, rotation: 0, hasSnowCap: true },    // Grand Crystal Peak
    { x: 0, z: -150, scaleX: 40, scaleY: 38, rotation: 0.15, hasSnowCap: true },   // Sentinel Mountain
    { x: 70, z: -135, scaleX: 32, scaleY: 28, rotation: -0.1, hasSnowCap: true },  // Twin Crystal Spire
    { x: -45, z: -160, scaleX: 25, scaleY: 24, rotation: 0.25, hasSnowCap: true }, // Aurora Peak
    { x: 50, z: -170, scaleX: 28, scaleY: 26, rotation: -0.2, hasSnowCap: true }   // Starfall Mountain
  ],
  
  // Floating crystal platforms around the lake
  cityBuildings: [
    // Elven observation platforms - glowing cyan structures
    { x: -35, z: -20, height: 6, width: 4, depth: 4, color: '#00f5d4' },  // Cyan crystal platform
    { x: 30, z: -50, height: 8, width: 3, depth: 3, color: '#7df9ff' },   // Ice-blue spire
    { x: -25, z: -80, height: 5, width: 5, depth: 5, color: '#00f5d4' },  // Meditation pavilion
    { x: 40, z: -30, height: 7, width: 4, depth: 4, color: '#a0e7e5' },   // Crystal watchtower
  ]
};
