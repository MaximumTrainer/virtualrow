// River Thames London (UK) landmark configuration
import type { RouteLandmarkConfig, RouteDetector } from './types';

export const londonDetector: RouteDetector = (routeName, routeTags) => {
  return routeName?.toLowerCase().includes('thames') || 
         routeName?.toLowerCase().includes('london') || 
         routeTags?.includes('london') || 
         false;
};

export const londonConfig: RouteLandmarkConfig = {
  routeId: 'river-thames-london',
  routeType: 'river',
  
  // Big Ben / Elizabeth Tower and Houses of Parliament on the left bank
  clockTower: {
    x: -25,
    z: -60,
    towerHeight: 18,
    towerWidth: 3,
    clockSize: 2.5,
    parliamentLength: 25,
    parliamentHeight: 8
  },
  
  // Tower Bridge - iconic bascule bridge
  towerBridge: {
    x: 0,
    z: -120,
    towerHeight: 15,
    towerWidth: 4,
    bridgeWidth: 50,
    bridgeHeight: 3
  },
  
  // London Eye on the right bank (South Bank)
  observationWheel: {
    x: 30,
    z: -40,
    radius: 12,
    spokeCount: 16
  },
  
  // The Shard - tallest building in London
  pyramidalTower: {
    x: 35,
    z: -150,
    height: 28,
    baseWidth: 5
  },
  
  // St Paul's Cathedral dome
  domeBuildingSecondary: {
    x: -30,
    z: -180,
    domeRadius: 5,
    buildingWidth: 12,
    buildingHeight: 8,
    hasColumns: true,
    hasCross: true
  },
  
  // Generic London buildings along both banks
  cityBuildings: [
    { x: -28, z: -100, height: 10, width: 4, depth: 4, color: '#78716c' },
    { x: -35, z: -140, height: 12, width: 5, depth: 4, color: '#6b7280' },
    { x: 32, z: -80, height: 8, width: 6, depth: 5, color: '#64748b' },
    { x: 38, z: -110, height: 14, width: 4, depth: 4, color: '#5c6370' },
    { x: -32, z: -200, height: 9, width: 5, depth: 4, color: '#78716c' },
    { x: 35, z: -180, height: 11, width: 4, depth: 4, color: '#6b7280' }
  ],
  
  // Additional bridges along the Thames
  bridges: [
    { x: 0, z: -80, width: 40, height: 2, archCount: 5, name: 'Westminster' },
    { x: 0, z: -160, width: 40, height: 2, archCount: 6, name: 'Millennium' },
    { x: 0, z: -220, width: 40, height: 2.5, archCount: 4, name: 'Southwark' }
  ]
};
