// Venice Grand Canal - "Canale delle Anime Perdute" (Canal of Lost Souls) Fantasy Configuration
// Theme: Gothic spectral Venice, phantom gondoliers, sunken palaces rising from the depths
// The waters glow an eerie phosphorescent green, ghostly figures drift past ruined palazzos
import type { RouteLandmarkConfig, RouteDetector } from './types';

export const veniceDetector: RouteDetector = (routeName, routeTags) => {
  return routeName?.toLowerCase().includes('venice') || 
         routeName?.toLowerCase().includes('anime') ||
         routeName?.toLowerCase().includes('perdute') ||
         routeTags?.includes('venice') || 
         routeTags?.includes('italy') || 
         routeTags?.includes('gothic') ||
         false;
};

export const veniceConfig: RouteLandmarkConfig = {
  routeId: 'venice-grand-canal',
  routeType: 'canal',
  
  // Spectral bridges - ancient stone arches draped in ghostly mist
  bridges: [
    { x: 0, z: -20, width: 25, height: 3, archCount: 1, name: 'Ponte degli Spettri' },      // Bridge of Specters (near Scalzi)
    { x: 0, z: -80, width: 35, height: 5, archCount: 1, name: 'Rialto delle Ombre' },      // Rialto of Shadows - massive haunted arch
    { x: 0, z: -140, width: 28, height: 3.5, archCount: 3, name: 'Accademia Maledetta' },  // Cursed Academy Bridge
    { x: 0, z: -200, width: 22, height: 3, archCount: 1, name: 'Ponte dell\'Oblio' }       // Bridge of Oblivion
  ],
  
  // Ruined Gothic palaces - half-sunken, crumbling, with ghostly lights in windows
  cityBuildings: [
    // Ca' d'Oro Ruins - once golden, now a spectral shell
    { x: 22, z: -30, height: 14, width: 10, depth: 7, color: '#2d3436' },   // Blackened stone
    // Palazzo Vendramin - haunted casino with green-lit windows
    { x: -24, z: -50, height: 12, width: 9, depth: 6, color: '#1e272e' },   // Dark manor
    // Ca' Rezzonico - baroque ruin, tilting into the canal
    { x: 20, z: -100, height: 16, width: 12, depth: 8, color: '#2c3e50' },  // Towering ruin
    // Ca' Foscari - gothic spires pierce the mist
    { x: -22, z: -130, height: 15, width: 10, depth: 7, color: '#34495e' }, // Spectral academy
    // Palazzo Barbarigo - ghostly frescoes glow faintly
    { x: 24, z: -160, height: 11, width: 8, depth: 6, color: '#2d3436' },   // Faded grandeur
    // Peggy Guggenheim's Haunted Gallery
    { x: -20, z: -180, height: 8, width: 14, depth: 8, color: '#1e272e' },  // Low, ominous
    // Sunken palazzo emerging from depths
    { x: 26, z: -90, height: 18, width: 8, depth: 6, color: '#0a3d62' },    // Rising from water
    { x: -26, z: -110, height: 10, width: 6, depth: 5, color: '#192a56' }   // Half-submerged
  ],
  
  // Santa Maria della Salute - transformed into a massive spectral cathedral
  // Its dome pulses with ghostly light, summoning the souls of the drowned
  domeBuildingSecondary: {
    x: -35,
    z: -220,
    domeRadius: 10,        // Massive dome
    buildingWidth: 20,
    buildingHeight: 14,
    hasColumns: true,      // Crumbling colonnades
    hasCross: true         // Spectral cross burns with cold fire
  },
  
  // The Campanile of Whispers - ghostly bell tower calling lost souls
  clockTower: {
    x: 40,
    z: -240,
    towerHeight: 28,       // Impossibly tall, fading into mist
    towerWidth: 4,
    clockSize: 2.5         // Clock frozen at midnight
  }
};
