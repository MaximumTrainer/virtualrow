// Henley Royal Regatta (UK) landmark configuration
import type { RouteLandmarkConfig, RouteDetector } from './types';

export const henleyDetector: RouteDetector = (routeName, routeTags) => {
  return routeName?.toLowerCase().includes('henley') || 
         routeTags?.includes('henley') || 
         routeTags?.includes('regatta') || 
         false;
};

export const henleyConfig: RouteLandmarkConfig = {
  routeId: 'henley-regatta',
  routeType: 'river',
  
  // Henley Bridge - historic stone bridge at finish line
  bridges: [
    { x: 0, z: -20, width: 35, height: 3, archCount: 5, name: 'Henley Bridge' }
  ],
  
  // Henley-on-Thames town buildings
  cityBuildings: [
    // St Mary's Church tower
    { x: -30, z: -15, height: 16, width: 4, depth: 4, color: '#9ca3af' },
    // Town Hall and historic buildings
    { x: -25, z: -30, height: 8, width: 6, depth: 5, color: '#d4c4a8' },
    { x: -28, z: -50, height: 7, width: 5, depth: 4, color: '#c9b896' },
    // Leander Club boathouse (iconic pink)
    { x: 25, z: -40, height: 6, width: 10, depth: 6, color: '#ffc0cb' },
    // Regatta enclosures and grandstands
    { x: 20, z: -80, height: 5, width: 15, depth: 4, color: '#f5f5f4' },
    { x: -22, z: -100, height: 5, width: 12, depth: 4, color: '#f5f5f4' },
    // Fawley Court in distance
    { x: 35, z: -200, height: 10, width: 12, depth: 8, color: '#e8dcc8' },
    // Temple Island folly
    { x: -5, z: -280, height: 8, width: 4, depth: 4, color: '#f5f5f4' }
  ],
  
  // Dome for the temple on Temple Island (classical folly)
  domeBuilding: {
    x: -5,
    z: -285,
    domeRadius: 2.5,
    buildingWidth: 5,
    buildingHeight: 6,
    hasColumns: true,
    hasCross: false
  },
  
  // University towers (Oxford rowing clubs visible)
  universityTowers: [
    { x: -35, z: -150, height: 8, width: 4, hasSpire: true }
  ]
};
