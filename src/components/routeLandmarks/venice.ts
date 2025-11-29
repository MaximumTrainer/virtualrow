// Venice Grand Canal landmark configuration
import type { RouteLandmarkConfig, RouteDetector } from './types';

export const veniceDetector: RouteDetector = (routeName, routeTags) => {
  return routeName?.toLowerCase().includes('venice') || 
         routeTags?.includes('venice') || 
         routeTags?.includes('italy') || 
         false;
};

export const veniceConfig: RouteLandmarkConfig = {
  routeId: 'venice-grand-canal',
  routeType: 'canal',
  
  // Rialto Bridge - iconic stone arch bridge
  bridges: [
    { x: 0, z: -40, width: 30, height: 4, archCount: 1, name: 'Rialto' },
    { x: 0, z: -120, width: 25, height: 3, archCount: 3, name: 'Accademia' },
    { x: 0, z: -200, width: 20, height: 3, archCount: 1, name: 'Scalzi' }
  ],
  
  // Venice palaces and churches along the canal
  cityBuildings: [
    // Ca' d'Oro - Gothic palace on right bank
    { x: 20, z: -30, height: 12, width: 8, depth: 6, color: '#f5deb3' },
    // Ca' Rezzonico on left bank
    { x: -22, z: -80, height: 14, width: 10, depth: 7, color: '#e8dcc8' },
    // Palazzo Grassi
    { x: 18, z: -100, height: 11, width: 7, depth: 5, color: '#f5f5f4' },
    // Ca' Foscari
    { x: -20, z: -140, height: 13, width: 9, depth: 6, color: '#d4c4a8' },
    // Palazzo Barbarigo
    { x: 22, z: -160, height: 10, width: 6, depth: 5, color: '#c9b896' },
    // Santa Maria della Salute area
    { x: -25, z: -220, height: 8, width: 10, depth: 8, color: '#f5f5f4' }
  ],
  
  // Dome for Santa Maria della Salute
  domeBuildingSecondary: {
    x: -30,
    z: -230,
    domeRadius: 6,
    buildingWidth: 14,
    buildingHeight: 10,
    hasColumns: true,
    hasCross: true
  },
  
  // Bell tower / campanile (like San Marco in the distance)
  clockTower: {
    x: 35,
    z: -250,
    towerHeight: 20,
    towerWidth: 3,
    clockSize: 1.5
  }
};
