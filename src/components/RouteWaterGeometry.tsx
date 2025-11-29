// Geographically accurate route rendering component
// This renders water and banks that follow the actual GPX route geometry

import React, { useMemo } from 'react';
import { Vector3, BufferGeometry, Float32BufferAttribute } from 'three';
import { createRouteCurve, getRoutePoints, generateBankGeometry } from '../utils/routeGeometry';
import type { Coordinate } from '../types/index';

interface RouteWaterGeometryProps {
  coordinates: Coordinate[];
  scale?: number; // World units per meter (default 0.01)
  waterWidth?: number; // Half-width of water in world units
  waterColor?: string;
  bankColor?: string;
  bankEdgeColor?: string;
  currentProgress?: number; // 0-1 representing boat position on route
}

/**
 * Creates a mesh strip geometry from two arrays of points (for water or ground)
 */
function createStripGeometry(
  leftPoints: Vector3[],
  rightPoints: Vector3[],
  yOffset: number = 0
): BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  
  const numPoints = Math.min(leftPoints.length, rightPoints.length);
  
  // Create vertices for each point pair
  for (let i = 0; i < numPoints; i++) {
    const left = leftPoints[i];
    const right = rightPoints[i];
    const t = i / (numPoints - 1);
    
    // Left vertex
    positions.push(left.x, yOffset, left.z);
    normals.push(0, 1, 0);
    uvs.push(0, t);
    
    // Right vertex
    positions.push(right.x, yOffset, right.z);
    normals.push(0, 1, 0);
    uvs.push(1, t);
  }
  
  // Create triangle indices (two triangles per quad)
  for (let i = 0; i < numPoints - 1; i++) {
    const bl = i * 2;      // bottom left
    const br = i * 2 + 1;  // bottom right
    const tl = (i + 1) * 2;    // top left
    const tr = (i + 1) * 2 + 1; // top right
    
    // First triangle
    indices.push(bl, tl, br);
    // Second triangle
    indices.push(br, tl, tr);
  }
  
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  
  return geometry;
}

/**
 * Creates bank/shore geometry (strip on one side of the water)
 */
function createBankStripGeometry(
  innerPoints: Vector3[], // Edge closest to water
  width: number, // How wide the bank should be
  normals: Vector3[], // Direction from route center outward
  side: 'left' | 'right',
  yOffset: number = 0.01
): BufferGeometry {
  const positions: number[] = [];
  const norms: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  
  const numPoints = innerPoints.length;
  const multiplier = side === 'left' ? -1 : 1;
  
  for (let i = 0; i < numPoints; i++) {
    const inner = innerPoints[i];
    const normal = normals[i];
    const t = i / (numPoints - 1);
    
    // Inner edge (water side)
    positions.push(inner.x, yOffset, inner.z);
    norms.push(0, 1, 0);
    uvs.push(0, t);
    
    // Outer edge
    const outerX = inner.x + normal.x * width * multiplier;
    const outerZ = inner.z + normal.z * width * multiplier;
    positions.push(outerX, yOffset, outerZ);
    norms.push(0, 1, 0);
    uvs.push(1, t);
  }
  
  // Create triangle indices
  for (let i = 0; i < numPoints - 1; i++) {
    const bl = i * 2;
    const br = i * 2 + 1;
    const tl = (i + 1) * 2;
    const tr = (i + 1) * 2 + 1;
    
    indices.push(bl, tl, br);
    indices.push(br, tl, tr);
  }
  
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new Float32BufferAttribute(norms, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  
  return geometry;
}

export const RouteWaterGeometry: React.FC<RouteWaterGeometryProps> = ({
  coordinates,
  scale = 0.01,
  waterWidth = 4,
  waterColor = '#2d7dc9',
  bankColor = '#4ade80',
  bankEdgeColor = '#22c55e',
  currentProgress = 0
}) => {
  // Create the route curve and get route points
  const routeData = useMemo(() => {
    const result = createRouteCurve(coordinates, scale, 300);
    if (!result) return null;
    
    const routePoints = getRoutePoints(result.curve, result.totalMeters, 299);
    const { leftBank, rightBank } = generateBankGeometry(routePoints, waterWidth);
    
    return {
      curve: result.curve,
      routePoints,
      leftBank,
      rightBank,
      totalMeters: result.totalMeters,
      originLat: result.originLat,
      originLng: result.originLng
    };
  }, [coordinates, scale, waterWidth]);
  
  // Create geometries
  const { waterGeometry, leftBankGeometry, rightBankGeometry, leftEdgeGeometry, rightEdgeGeometry } = useMemo(() => {
    if (!routeData) return { 
      waterGeometry: null, 
      leftBankGeometry: null, 
      rightBankGeometry: null,
      leftEdgeGeometry: null,
      rightEdgeGeometry: null
    };
    
    const { routePoints, leftBank, rightBank } = routeData;
    const normals = routePoints.map(p => p.normal);
    
    // Water surface - between left and right banks
    const waterGeo = createStripGeometry(leftBank, rightBank, -0.02);
    
    // Bank geometry - wider strips on each side
    const bankWidth = 25; // Width of each bank
    const edgeWidth = 3; // Darker edge near water
    
    // Left bank (main grass)
    const leftBankGeo = createBankStripGeometry(leftBank, bankWidth, normals, 'left', 0.01);
    
    // Right bank (main grass) 
    const rightBankGeo = createBankStripGeometry(rightBank, bankWidth, normals, 'right', 0.01);
    
    // Left edge (darker grass near water)
    const leftEdgeGeo = createBankStripGeometry(leftBank, edgeWidth, normals, 'left', 0.02);
    
    // Right edge (darker grass near water)
    const rightEdgeGeo = createBankStripGeometry(rightBank, edgeWidth, normals, 'right', 0.02);
    
    return {
      waterGeometry: waterGeo,
      leftBankGeometry: leftBankGeo,
      rightBankGeometry: rightBankGeo,
      leftEdgeGeometry: leftEdgeGeo,
      rightEdgeGeometry: rightEdgeGeo
    };
  }, [routeData]);
  
  // Calculate offset to center view around current boat position
  const viewOffset = useMemo(() => {
    if (!routeData || !routeData.curve) return { x: 0, z: 0, rotation: 0 };
    
    const pos = routeData.curve.getPointAt(Math.max(0, Math.min(1, currentProgress)));
    const tangent = routeData.curve.getTangentAt(Math.max(0, Math.min(1, currentProgress)));
    const rotation = Math.atan2(tangent.x, -tangent.z);
    
    return { x: pos.x, z: pos.z, rotation };
  }, [routeData, currentProgress]);
  
  if (!routeData || !waterGeometry) return null;
  
  return (
    <group 
      position={[-viewOffset.x, 0, -viewOffset.z]} 
      rotation={[0, -viewOffset.rotation, 0]}
    >
      {/* Water surface */}
      <mesh geometry={waterGeometry}>
        <meshStandardMaterial 
          color={waterColor}
          metalness={0.6}
          roughness={0.3}
          envMapIntensity={1.0}
        />
      </mesh>
      
      {/* Left bank (main grass) */}
      {leftBankGeometry && (
        <mesh geometry={leftBankGeometry}>
          <meshStandardMaterial color={bankColor} roughness={0.9} />
        </mesh>
      )}
      
      {/* Right bank (main grass) */}
      {rightBankGeometry && (
        <mesh geometry={rightBankGeometry}>
          <meshStandardMaterial color={bankColor} roughness={0.9} />
        </mesh>
      )}
      
      {/* Left edge (darker grass near water) */}
      {leftEdgeGeometry && (
        <mesh geometry={leftEdgeGeometry}>
          <meshStandardMaterial color={bankEdgeColor} roughness={0.9} />
        </mesh>
      )}
      
      {/* Right edge (darker grass near water) */}
      {rightEdgeGeometry && (
        <mesh geometry={rightEdgeGeometry}>
          <meshStandardMaterial color={bankEdgeColor} roughness={0.9} />
        </mesh>
      )}
    </group>
  );
};

export default RouteWaterGeometry;

/**
 * Hook to get route curve and origin data for use in other components
 */
export function useRouteGeometry(coordinates: Coordinate[], scale: number = 0.01) {
  return useMemo(() => {
    return createRouteCurve(coordinates, scale, 300);
  }, [coordinates, scale]);
}
