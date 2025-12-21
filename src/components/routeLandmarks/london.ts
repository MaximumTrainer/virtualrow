// River Thames London - "The Leviathan's Wake" Fantasy Configuration
// Theme: Neo-noir dystopian flooded London, kaiju-sized sea creatures lurk below
// Massive tentacles occasionally breach the surface, ruined skyscrapers pierce toxic fog
import type { RouteLandmarkConfig, RouteDetector } from './types';

export const londonDetector: RouteDetector = (routeName, routeTags) => {
  return routeName?.toLowerCase().includes('thames') || 
         routeName?.toLowerCase().includes('london') || 
         routeName?.toLowerCase().includes('leviathan') ||
         routeTags?.includes('london') || 
         routeTags?.includes('dystopian') ||
         routeTags?.includes('kaiju') ||
         false;
};

export const londonConfig: RouteLandmarkConfig = {
  routeId: 'river-thames-london',
  routeType: 'river',
  
  // Parliament Ruins - Elizabeth Tower half-collapsed, clock frozen
  // Warning sirens permanently mounted, rusted but still operational
  clockTower: {
    x: -30,
    z: -60,
    towerHeight: 14,         // Partially collapsed, shorter
    towerWidth: 4,
    clockSize: 3,            // Cracked clock face
    parliamentLength: 30,    // Ruined, partially submerged
    parliamentHeight: 6      // Lower, flooded ground floors
  },
  
  // Tower Bridge - battle-scarred, reinforced with anti-kaiju armor plating
  // One tower damaged, bridge raised permanently as sea barrier
  towerBridge: {
    x: 0,
    z: -120,
    towerHeight: 18,         // Reinforced, weaponized
    towerWidth: 6,           // Thicker armor plating
    bridgeWidth: 60,         // Extended barriers
    bridgeHeight: 8          // Raised high
  },
  
  // London Eye - transformed into a massive radar/sonar array
  // Detects approaching leviathans, spokes are sensor arrays
  observationWheel: {
    x: 35,
    z: -40,
    radius: 18,              // Larger, more imposing
    spokeCount: 24           // More sensor arrays
  },
  
  // The Shard - now a defensive spire, upper sections weaponized
  // Massive harpoon launchers visible, searchlights sweep the fog
  pyramidalTower: {
    x: 40,
    z: -150,
    height: 40,              // Even taller, more menacing
    baseWidth: 8
  },
  
  // St Paul's Cathedral - converted to a survivor bunker
  // Dome reinforced, makeshift walls surround the structure
  domeBuildingSecondary: {
    x: -35,
    z: -180,
    domeRadius: 7,
    buildingWidth: 16,
    buildingHeight: 10,
    hasColumns: true,
    hasCross: true           // Beacon light instead of cross
  },
  
  // Ruined London skyline - flooded, damaged, some rebuilt as fortresses
  cityBuildings: [
    // Flooded office blocks - dark, abandoned
    { x: -32, z: -100, height: 12, width: 5, depth: 5, color: '#1a1a2e' },  // Dark ruin
    { x: -38, z: -140, height: 16, width: 6, depth: 5, color: '#16213e' },  // Flooded tower
    // Survivor compounds - lights visible, armored
    { x: 38, z: -80, height: 10, width: 8, depth: 6, color: '#0f3460' },    // Fortified
    { x: 42, z: -110, height: 18, width: 5, depth: 5, color: '#1a1a2e' },   // Watch tower
    // Damaged Gherkin-like structure
    { x: -36, z: -200, height: 14, width: 6, depth: 6, color: '#16213e' },  // Half-collapsed
    // Military installations
    { x: 40, z: -180, height: 8, width: 10, depth: 8, color: '#0f3460' },   // Command center
    { x: -30, z: -220, height: 6, width: 12, depth: 10, color: '#162447' }, // Munitions depot
    // Tentacle damage visible on buildings
    { x: 45, z: -200, height: 20, width: 4, depth: 4, color: '#1a1a2e' },   // Scarred tower
  ],
  
  // Fortified bridge crossings - militarized, checkpoints
  bridges: [
    { x: 0, z: -80, width: 50, height: 4, archCount: 3, name: 'Westminster Barricade' },
    { x: 0, z: -160, width: 55, height: 3, archCount: 1, name: 'Millennium Defense Line' },
    { x: 0, z: -220, width: 45, height: 4, archCount: 4, name: 'Southwark Checkpoint' }
  ],
  
  // Additional dystopian skyscrapers - rebuilt as defensive towers
  skyscrapers: [
    { x: -45, z: -90, height: 25, width: 5, depth: 5, color: '#0f3460', hasAntenna: true },  // Comms tower
    { x: 48, z: -130, height: 30, width: 4, depth: 4, color: '#1a1a2e', hasAntenna: true },  // Radar mast
    { x: -42, z: -170, height: 22, width: 6, depth: 6, color: '#16213e', hasAntenna: false } // Harpoon platform
  ]
};
