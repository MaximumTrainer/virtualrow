// Henley Royal Regatta - "The Iron Sovereign's Gauntlet" Fantasy Configuration
// Theme: Steampunk Victorian, brass automatons, clockwork timing towers, steam-powered grandstands
// The river runs between massive brass gantries and gear-driven timing mechanisms
import type { RouteLandmarkConfig, RouteDetector } from './types';

export const henleyDetector: RouteDetector = (routeName, routeTags) => {
  return routeName?.toLowerCase().includes('henley') || 
         routeName?.toLowerCase().includes('iron sovereign') ||
         routeName?.toLowerCase().includes('gauntlet') ||
         routeTags?.includes('henley') || 
         routeTags?.includes('regatta') || 
         routeTags?.includes('steampunk') ||
         false;
};

export const henleyConfig: RouteLandmarkConfig = {
  routeId: 'henley-regatta',
  routeType: 'river',
  
  // Massive brass and iron bridge with clockwork gantries - the finish line
  bridges: [
    { x: 0, z: -20, width: 45, height: 8, archCount: 3, name: 'Iron Sovereign Gate' }  // Grand brass finish arch
  ],
  
  // Steampunk Victorian structures lining the race course
  cityBuildings: [
    // The Grand Clockwork Tower - replaces St Mary's Church
    // Massive gears visible, steam venting from pipes
    { x: -35, z: -15, height: 28, width: 6, depth: 6, color: '#b87333' },   // Copper tower
    
    // Steam-Powered Timing House - Victorian control center
    { x: -30, z: -35, height: 12, width: 10, depth: 8, color: '#cd853f' },  // Brass building
    
    // The Automaton Works - factory producing race officials
    { x: -32, z: -60, height: 10, width: 14, depth: 10, color: '#8b4513' }, // Industrial brick
    
    // Leander Steamworks - legendary rowing club's brass-clad boathouse
    { x: 28, z: -40, height: 10, width: 14, depth: 8, color: '#daa520' },   // Golden brass
    
    // The Iron Grandstands - steam-powered seating platforms
    { x: 25, z: -80, height: 8, width: 20, depth: 6, color: '#8b7355' },    // Bronze framework
    { x: -28, z: -100, height: 8, width: 18, depth: 6, color: '#8b7355' },  // Bronze framework
    
    // Gear-Driven Observation Platforms
    { x: 30, z: -120, height: 15, width: 5, depth: 5, color: '#b87333' },   // Copper observation
    { x: -30, z: -140, height: 14, width: 5, depth: 5, color: '#cd7f32' },  // Bronze watchtower
    
    // The Sovereign's Pavilion - brass and glass royal viewing box
    { x: 35, z: -180, height: 12, width: 16, depth: 10, color: '#daa520' }, // Gilded brass
    
    // Temple Island Clockwork Folly - start line mechanism
    { x: -8, z: -280, height: 14, width: 8, depth: 8, color: '#b87333' }    // Copper temple
  ],
  
  // The Great Timing Dome - massive clockwork mechanism temple
  domeBuilding: {
    x: -8,
    z: -285,
    domeRadius: 5,            // Large gear-like dome
    buildingWidth: 10,
    buildingHeight: 10,
    hasColumns: true,         // Brass pillars
    hasCross: false           // No cross - replaced by gear symbol
  },
  
  // Clockwork timing towers along the course
  universityTowers: [
    { x: -38, z: -150, height: 18, width: 4, hasSpire: true },   // Steam-venting spire
    { x: 38, z: -200, height: 16, width: 4, hasSpire: true },    // Brass observation tower
    { x: -40, z: -230, height: 20, width: 5, hasSpire: true }    // Grand timing tower
  ],
  
  // The Iron Sovereign's Clock Tower - massive finish line timekeeper
  clockTower: {
    x: 40,
    z: -10,
    towerHeight: 35,          // Towering brass structure
    towerWidth: 6,
    clockSize: 4              // Massive clock face with exposed gears
  }
};
