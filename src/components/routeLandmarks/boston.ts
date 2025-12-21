// Charles River Boston - "The Architect's Infinite Equation" Fantasy Configuration
// Theme: Reality-bending academic magic, impossible geometries, tesseract architecture
// Buildings fold into impossible dimensions, equations float in the air, Escher-like bridges
import type { RouteLandmarkConfig, RouteDetector } from './types';

export const bostonDetector: RouteDetector = (routeName, routeTags) => {
  return routeName?.toLowerCase().includes('charles') || 
         routeName?.toLowerCase().includes('boston') || 
         routeName?.toLowerCase().includes('architect') ||
         routeName?.toLowerCase().includes('equation') ||
         routeTags?.includes('boston') || 
         routeTags?.includes('scifi') ||
         false;
};

export const bostonConfig: RouteLandmarkConfig = {
  routeId: 'charles-river-boston',
  routeType: 'river',
  
  // Tesseract Academy Towers - Harvard transformed into impossible geometry
  // Towers that seem to fold in on themselves, defying Euclidean space
  universityTowers: [
    { x: -28, z: -75, height: 18, width: 4, hasSpire: true },   // Recursive spire
    { x: -24, z: -90, height: 14, width: 5, hasSpire: false },  // Hypercube tower
    { x: -32, z: -110, height: 20, width: 3, hasSpire: true },  // Dimensional needle
    { x: -26, z: -130, height: 12, width: 6, hasSpire: false }  // Folding library
  ],
  
  // MIT Infinite Dome - the source of the reality distortion
  // Equations and formulae projected onto its surface, geometry shifts
  domeBuilding: {
    x: -35,
    z: -160,
    domeRadius: 8,           // Larger, more prominent
    buildingWidth: 18,
    buildingHeight: 10,
    hasColumns: true,        // Columns that twist impossibly
    hasCross: false          // No cross - mathematical symbols instead
  },
  
  // Boston Skyline - transformed into geometric impossibilities
  // Skyscrapers that bend, rotate, and intersect in non-Euclidean ways
  skyscrapers: [
    // Prudential Paradox - twisting crystalline structure
    { x: 40, z: -120, height: 28, width: 5, depth: 5, color: '#00f5d4', hasAntenna: true },
    // Hancock Hologram - transparent geometric form
    { x: 45, z: -100, height: 32, width: 4, depth: 4, color: '#7df9ff', hasAntenna: true },
    // Mobius Tower - appears to twist back on itself
    { x: 38, z: -90, height: 18, width: 4, depth: 4, color: '#00d9ff' },
    // Tesseract Building - four-dimensional shadow
    { x: 42, z: -145, height: 22, width: 5, depth: 5, color: '#40e0d0' },
    // Fractal Spire - self-similar at all scales
    { x: 36, z: -170, height: 16, width: 4, depth: 4, color: '#00ced1' },
    // Klein Bottle Tower - inside is outside
    { x: 48, z: -130, height: 24, width: 3, depth: 3, color: '#48d1cc' }
  ],
  
  // Academic buildings transformed - glowing with calculation energy
  cityBuildings: [
    // Infinite Library - books containing all possible knowledge
    { x: -32, z: -145, height: 8, width: 12, depth: 6, color: '#00f5d4' },
    // Proof Pavilion - where theorems materialize
    { x: -36, z: -175, height: 10, width: 8, depth: 5, color: '#7df9ff' },
    // Algorithm Archive - patterns compute themselves
    { x: -28, z: -195, height: 6, width: 10, depth: 6, color: '#40e0d0' },
    // Quantum Quad - exists in superposition
    { x: 32, z: -85, height: 7, width: 8, depth: 6, color: '#00ced1' }
  ],
  
  // Escher Bridges - impossible staircases over water
  // Bridges that loop, twist, and connect in impossible ways
  bridges: [
    { x: 0, z: -60, width: 50, height: 4, archCount: 7, name: 'Penrose Crossing' },
    { x: 0, z: -140, width: 55, height: 5, archCount: 9, name: 'Infinite Loop Bridge' },
    { x: 0, z: -200, width: 45, height: 3, archCount: 5, name: 'Mobius Span' }
  ],
  
  // Secondary dome - the Probability Engine
  domeBuildingSecondary: {
    x: 38,
    z: -80,
    domeRadius: 4,
    buildingWidth: 10,
    buildingHeight: 6,
    hasColumns: true,
    hasCross: false          // Geometric symbol
  }
};
