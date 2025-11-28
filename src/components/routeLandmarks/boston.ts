// Charles River Boston (USA) landmark configuration
import type { RouteLandmarkConfig, RouteDetector } from './types';

export const bostonDetector: RouteDetector = (routeName, routeTags) => {
  return routeName?.toLowerCase().includes('charles') || 
         routeName?.toLowerCase().includes('boston') || 
         routeTags?.includes('boston') || 
         false;
};

export const bostonConfig: RouteLandmarkConfig = {
  routeId: 'charles-river-boston',
  routeType: 'river',
  
  // Harvard University buildings on the left bank (Cambridge side)
  universityTowers: [
    { x: -26, z: -75, height: 10, width: 4, hasSpire: true },
    { x: -22, z: -85, height: 8, width: 5, hasSpire: false }
  ],
  
  // MIT dome and buildings on the Cambridge side
  domeBuilding: {
    x: -30,
    z: -150,
    domeRadius: 4,
    buildingWidth: 12,
    buildingHeight: 6,
    hasColumns: true,
    hasCross: false
  },
  
  // Boston skyline on the right bank
  skyscrapers: [
    // Prudential Tower
    { x: 35, z: -120, height: 20, width: 4, depth: 4, color: '#5c6370', hasAntenna: true },
    // John Hancock Tower
    { x: 40, z: -100, height: 22, width: 3.5, depth: 3.5, color: '#4a90a4', hasAntenna: true },
    // Generic skyscrapers
    { x: 32, z: -90, height: 12, width: 3, depth: 3, color: '#6b7280' },
    { x: 38, z: -140, height: 14, width: 3.5, depth: 3.5, color: '#78716c' },
    { x: 30, z: -160, height: 10, width: 4, depth: 4, color: '#64748b' }
  ],
  
  // Additional MIT buildings
  cityBuildings: [
    { x: -28, z: -145, height: 5, width: 8, depth: 4, color: '#d4c4a8' },
    { x: -32, z: -155, height: 6, width: 6, depth: 4, color: '#d4c4a8' }
  ],
  
  // Bridge structures along the Charles
  bridges: [
    { x: 0, z: -60, width: 40, height: 2, archCount: 5, name: 'Mass Ave' },
    { x: 0, z: -130, width: 40, height: 2.5, archCount: 7, name: 'Harvard' },
    { x: 0, z: -200, width: 40, height: 2, archCount: 4, name: 'BU' }
  ]
};
