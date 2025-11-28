// Types for route-specific landmark configurations
// These types define the data structures that can be injected into the generic Rower3D component

// Castle landmark (e.g., Bled Castle)
export interface CastleLandmark {
  x: number;
  z: number;
  height: number;
  width: number;
  depth: number;
  towers?: Array<{
    x: number;
    z: number;
    height: number;
    radius: number;
    roofHeight?: number;
  }>;
}

// Island with church/building (e.g., Bled Island)
export interface IslandLandmark {
  x: number;
  z: number;
  radius?: number;
  churchHeight?: number;
  stepsToChurch?: boolean;
}

// Mountain/Alps landmark
export interface MountainLandmark {
  x: number;
  z: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
  hasSnowCap?: boolean;
}

// Clock tower landmark (e.g., Big Ben)
export interface ClockTowerLandmark {
  x: number;
  z: number;
  towerHeight: number;
  towerWidth: number;
  clockSize: number;
  parliamentLength?: number;
  parliamentHeight?: number;
}

// Bascule/Tower bridge landmark (e.g., Tower Bridge)
export interface TowerBridgeLandmark {
  x: number;
  z: number;
  towerHeight: number;
  towerWidth: number;
  bridgeWidth: number;
  bridgeHeight: number;
}

// Observation wheel landmark (e.g., London Eye)
export interface ObservationWheelLandmark {
  x: number;
  z: number;
  radius: number;
  spokeCount: number;
}

// Pyramidal skyscraper (e.g., The Shard)
export interface PyramidalTowerLandmark {
  x: number;
  z: number;
  height: number;
  baseWidth: number;
}

// Dome building (e.g., MIT, St Paul's)
export interface DomeBuildingLandmark {
  x: number;
  z: number;
  domeRadius: number;
  buildingWidth: number;
  buildingHeight: number;
  hasColumns?: boolean;
  hasCross?: boolean;
}

// University tower with optional spire
export interface UniversityTowerLandmark {
  x: number;
  z: number;
  height: number;
  width: number;
  hasSpire: boolean;
}

// Generic skyscraper/building
export interface SkyscraperLandmark {
  x: number;
  z: number;
  height: number;
  width: number;
  depth: number;
  color: string;
  hasAntenna?: boolean;
}

// Bridge landmark
export interface BridgeLandmark {
  x: number;
  z: number;
  width: number;
  height: number;
  archCount: number;
  name?: string;
}

// Complete route landmark configuration
export interface RouteLandmarkConfig {
  routeId: string;
  routeType: 'lake' | 'river' | 'canal';
  
  // Lake Bled style landmarks
  castle?: CastleLandmark;
  island?: IslandLandmark;
  mountains?: MountainLandmark[];
  
  // London style landmarks
  clockTower?: ClockTowerLandmark;
  towerBridge?: TowerBridgeLandmark;
  observationWheel?: ObservationWheelLandmark;
  pyramidalTower?: PyramidalTowerLandmark;
  
  // Boston style landmarks
  universityTowers?: UniversityTowerLandmark[];
  domeBuilding?: DomeBuildingLandmark;
  domeBuildingSecondary?: DomeBuildingLandmark;
  
  // Common landmarks
  skyscrapers?: SkyscraperLandmark[];
  bridges?: BridgeLandmark[];
  cityBuildings?: SkyscraperLandmark[];
}

// Route detection function type
export type RouteDetector = (routeName: string, routeTags: string[]) => boolean;

// Map of route identifiers to their landmark configs
export interface RouteLandmarkRegistry {
  [key: string]: {
    detector: RouteDetector;
    config: RouteLandmarkConfig;
  };
}
