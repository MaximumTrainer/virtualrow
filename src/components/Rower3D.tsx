import React, { useRef, useMemo, useEffect, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Environment, Sky, Cloud } from '@react-three/drei';
import { EffectComposer, Bloom, ToneMapping } from '@react-three/postprocessing';
import { ToneMappingMode } from 'postprocessing';
import * as THREE from 'three';
import type { WaterRoute, Coordinate } from '../types/index';
import { routeTotalDistanceMeters, latLngToMeters } from '../utils/geoUtils';
import { isWebGPUAvailable, isWebGLAvailable } from '../utils/gpuUtils';
import './Rower3D.css';

// ============================================================================
// GPS TO 3D PATH CONVERSION - Converts GPS coordinates to smooth 3D curve
// ============================================================================

// Convert GPS coordinates to 3D scene points
const gpsToScenePoints = (coordinates: Coordinate[], sceneScale: number = 0.1): THREE.Vector3[] => {
  if (coordinates.length < 2) return [];
  
  // Use first coordinate as origin
  const origin = coordinates[0];
  const points: THREE.Vector3[] = [];
  
  for (const coord of coordinates) {
    const meters = latLngToMeters(coord.lat, coord.lng, origin.lat, origin.lng);
    // Convert to scene coordinates: x = east/west, z = north/south (inverted for -Z forward)
    points.push(new THREE.Vector3(
      meters.x * sceneScale,
      0,
      -meters.y * sceneScale  // Negative because boat moves in -Z direction
    ));
  }
  
  return points;
};

// Create a smooth Catmull-Rom spline from GPS points
const createRouteCurve = (coordinates: Coordinate[], sceneScale: number = 0.1): THREE.CatmullRomCurve3 | null => {
  const points = gpsToScenePoints(coordinates, sceneScale);
  if (points.length < 2) return null;
  
  // Create smooth curve with closed=false (not a loop)
  return new THREE.CatmullRomCurve3(points, false, 'catmullrom', 0.5);
};

// Get position and tangent at a given progress (0-1) along the route
interface RoutePosition {
  position: THREE.Vector3;
  tangent: THREE.Vector3;
  angle: number;  // Rotation angle in radians (around Y axis)
}

const getRoutePositionAtProgress = (
  curve: THREE.CatmullRomCurve3 | null, 
  progress: number
): RoutePosition => {
  if (!curve) {
    // Fallback to straight line
    return {
      position: new THREE.Vector3(0, 0, -progress * 100),
      tangent: new THREE.Vector3(0, 0, -1),
      angle: 0
    };
  }
  
  const clampedProgress = Math.max(0, Math.min(1, progress));
  const position = curve.getPointAt(clampedProgress);
  const tangent = curve.getTangentAt(clampedProgress).normalize();
  
  // Calculate angle from tangent (rotation around Y axis)
  // The boat's bow (front) is at local -Z, so we rotate to align local -Z with tangent
  // atan2(x, z) gives angle where tangent aligns with boat's forward direction
  const angle = Math.atan2(tangent.x, tangent.z);
  
  return { position, tangent, angle };
};

// Get cumulative distances along the curve for accurate distance-to-progress mapping
const getCurveDistances = (curve: THREE.CatmullRomCurve3, samples: number = 200): number[] => {
  const distances: number[] = [0];
  let totalDist = 0;
  
  for (let i = 1; i <= samples; i++) {
    const t0 = (i - 1) / samples;
    const t1 = i / samples;
    const p0 = curve.getPointAt(t0);
    const p1 = curve.getPointAt(t1);
    totalDist += p0.distanceTo(p1);
    distances.push(totalDist);
  }
  
  return distances;
};

// Convert distance traveled to progress (0-1) on the curve
const distanceToProgress = (
  distanceMeters: number, 
  totalDistanceMeters: number,
  curveDistances: number[],
  curveLength: number
): number => {
  if (totalDistanceMeters <= 0 || curveLength <= 0) return 0;
  
  // Map real-world distance to curve distance
  const curveDistance = (distanceMeters / totalDistanceMeters) * curveLength;
  
  // Binary search to find progress
  let low = 0;
  let high = curveDistances.length - 1;
  
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (curveDistances[mid] < curveDistance) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  
  // Interpolate for smoother result
  const idx = Math.max(0, low - 1);
  const nextIdx = Math.min(curveDistances.length - 1, low);
  const segmentStart = curveDistances[idx];
  const segmentEnd = curveDistances[nextIdx];
  const segmentLength = segmentEnd - segmentStart;
  
  let t = idx / (curveDistances.length - 1);
  if (segmentLength > 0) {
    const within = (curveDistance - segmentStart) / segmentLength;
    t += within / (curveDistances.length - 1);
  }
  
  return Math.max(0, Math.min(1, t));
};

// Water channel width constant - keeps water wider than single scull (~1.5m wide)
const WATER_CHANNEL_WIDTH = 20; // meters in scene units (boat is ~0.5 wide, water is 40x wider)
const RIVERBANK_WIDTH = 60; // width of each riverbank
const LANDSCAPE_OFFSET = 50; // minimum distance from water center to landscape objects

// GPU backend type for renderer selection
type GPUBackend = 'webgpu' | 'webgl' | 'none';

// Route theme types for landscape selection
type RouteTheme = 'willowbrook' | 'crystal-bled' | 'gothic-venice' | 'steampunk-henley' | 'dystopian-thames' | 'scifi-boston';

// Detect route theme from route name and tags
const detectRouteTheme = (route: WaterRoute): RouteTheme => {
  const name = route.name?.toLowerCase() || '';
  const tags = route.tags || [];
  
  if (name.includes('bled') || name.includes('crystal') || name.includes('sanctum') || tags.includes('elven')) {
    return 'crystal-bled';
  }
  if (name.includes('venice') || name.includes('anime') || name.includes('perdute') || tags.includes('gothic')) {
    return 'gothic-venice';
  }
  if (name.includes('henley') || name.includes('iron sovereign') || name.includes('gauntlet') || tags.includes('steampunk')) {
    return 'steampunk-henley';
  }
  if (name.includes('thames') || name.includes('leviathan') || tags.includes('dystopian') || tags.includes('kaiju')) {
    return 'dystopian-thames';
  }
  if (name.includes('charles') || name.includes('boston') || name.includes('architect') || name.includes('equation') || tags.includes('sci-fi')) {
    return 'scifi-boston';
  }
  return 'willowbrook';
};

interface Rower3DProps {
  route: WaterRoute;
  paceSPer500?: number | null;
  distanceMeters?: number | null;
  isPlaying?: boolean;
  cadence?: number | null;
  performanceMode?: 'auto' | 'high' | 'low';
  intensityFactor?: number;
  debugMode?: boolean;
}

// ============================================================================
// PHOTOREALISTIC WATER - PBR water with reflections, waves, and depth
// ============================================================================
const PhotorealisticWater: React.FC<{ boatZ: number; theme: RouteTheme }> = ({ boatZ, theme }) => {
  const meshRef = useRef<THREE.Mesh>(null);
  const materialRef = useRef<THREE.MeshPhysicalMaterial>(null);
  
  // Theme-based water colors matching reference image (grey-green murky)
  const waterConfig = useMemo(() => {
    switch (theme) {
      case 'crystal-bled':
        return { color: '#4a8fa8', transmission: 0.5, roughness: 0.08, emissive: '#00d9ff', emissiveIntensity: 0.08 };
      case 'gothic-venice':
        return { color: '#2a4a4a', transmission: 0.3, roughness: 0.15, emissive: '#0a3d62', emissiveIntensity: 0.02 };
      case 'steampunk-henley':
        return { color: '#4a5a41', transmission: 0.25, roughness: 0.2, emissive: '#4a6741', emissiveIntensity: 0.01 };
      case 'dystopian-thames':
        return { color: '#1a2a3a', transmission: 0.2, roughness: 0.25, emissive: '#162447', emissiveIntensity: 0.03 };
      case 'scifi-boston':
        return { color: '#1a4a5a', transmission: 0.4, roughness: 0.1, emissive: '#00ced1', emissiveIntensity: 0.1 };
      default: // Realistic river like reference image
        return { color: '#4a5a50', transmission: 0.35, roughness: 0.12, emissive: '#3a4a40', emissiveIntensity: 0.01 };
    }
  }, [theme]);
  
  // Animate water surface with procedural waves
  useFrame((state) => {
    if (materialRef.current) {
      // Subtle wave-like roughness variation over time
      const time = state.clock.elapsedTime;
      materialRef.current.roughness = waterConfig.roughness + Math.sin(time * 0.5) * 0.02;
    }
    // NOTE: Vertex displacement disabled for performance - use shader-based waves in future
  });
  
  return (
    <mesh 
      ref={meshRef}
      rotation={[-Math.PI / 2, 0, 0]} 
      position={[0, -0.1, boatZ]}
      receiveShadow
    >
      <planeGeometry args={[1000, 1000, 128, 128]} />
      <meshPhysicalMaterial
        ref={materialRef}
        color={waterConfig.color}
        metalness={0.1}
        roughness={waterConfig.roughness}
        transmission={waterConfig.transmission}
        thickness={2.0}
        ior={1.33} // Water refraction index
        reflectivity={0.9}
        clearcoat={0.3}
        clearcoatRoughness={0.4}
        envMapIntensity={1.5}
        transparent
        opacity={0.92}
        emissive={waterConfig.emissive}
        emissiveIntensity={waterConfig.emissiveIntensity}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
};

// ============================================================================
// MIST LAYER - Low-lying fog near water surface for atmosphere
// ============================================================================
const MistLayer: React.FC<{ boatZ: number; theme: RouteTheme }> = ({ boatZ, theme }) => {
  const mistOpacity = useMemo(() => {
    switch (theme) {
      case 'gothic-venice': return 0.25;  // Heavy mist
      case 'dystopian-thames': return 0.2; // Toxic haze
      case 'steampunk-henley': return 0.15; // Steam
      case 'crystal-bled': return 0.08;    // Light alpine mist
      case 'scifi-boston': return 0.1;     // Light neon haze
      default: return 0.12;                // Standard morning mist
    }
  }, [theme]);
  
  const mistColor = useMemo(() => {
    switch (theme) {
      case 'gothic-venice': return '#1e272e';
      case 'dystopian-thames': return '#1a1a2e';
      case 'steampunk-henley': return '#8b7355';
      case 'crystal-bled': return '#e8f4f8';
      case 'scifi-boston': return '#162447';
      default: return '#c8d4dc';
    }
  }, [theme]);
  
  return (
    <mesh position={[0, 0.8, boatZ]} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[800, 800]} />
      <meshBasicMaterial
        color={mistColor}
        transparent
        opacity={mistOpacity}
        depthWrite={false}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
};

// ============================================================================
// CURVED WATER CHANNEL - Follows GPS path with constant width
// ============================================================================
interface CurvedWaterChannelProps {
  curve: THREE.CatmullRomCurve3 | null;
  theme: RouteTheme;
  boatProgress: number;
}

const CurvedWaterChannel: React.FC<CurvedWaterChannelProps> = ({ curve, theme, boatProgress }) => {
  const meshRef = useRef<THREE.Mesh>(null);
  
  // Theme-based water colors
  const waterConfig = useMemo(() => {
    switch (theme) {
      case 'crystal-bled':
        return { color: '#4a8fa8', emissive: '#00d9ff', emissiveIntensity: 0.08 };
      case 'gothic-venice':
        return { color: '#2a4a4a', emissive: '#0a3d62', emissiveIntensity: 0.02 };
      case 'steampunk-henley':
        return { color: '#4a5a41', emissive: '#4a6741', emissiveIntensity: 0.01 };
      case 'dystopian-thames':
        return { color: '#1a2a3a', emissive: '#162447', emissiveIntensity: 0.03 };
      case 'scifi-boston':
        return { color: '#1a4a5a', emissive: '#00ced1', emissiveIntensity: 0.1 };
      default:
        return { color: '#4a5a50', emissive: '#3a4a40', emissiveIntensity: 0.01 };
    }
  }, [theme]);
  
  // Generate curved water geometry following the path
  const waterGeometry = useMemo(() => {
    if (!curve) return null;
    
    const segments = 200;
    const halfWidth = WATER_CHANNEL_WIDTH / 2;
    
    // Create geometry vertices following the curve
    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const point = curve.getPointAt(t);
      const tangent = curve.getTangentAt(t).normalize();
      
      // Calculate perpendicular direction (cross product with up vector)
      const up = new THREE.Vector3(0, 1, 0);
      const perp = new THREE.Vector3().crossVectors(tangent, up).normalize();
      
      // Left and right vertices
      const left = new THREE.Vector3().copy(point).addScaledVector(perp, -halfWidth);
      const right = new THREE.Vector3().copy(point).addScaledVector(perp, halfWidth);
      
      // Set Y position slightly below water level
      left.y = -0.1;
      right.y = -0.1;
      
      // Add vertices (left then right)
      positions.push(left.x, left.y, left.z);
      positions.push(right.x, right.y, right.z);
      
      // Normals pointing up
      normals.push(0, 1, 0);
      normals.push(0, 1, 0);
      
      // UVs
      uvs.push(0, t);
      uvs.push(1, t);
      
      // Create triangles (two per segment)
      if (i < segments) {
        const base = i * 2;
        // First triangle
        indices.push(base, base + 2, base + 1);
        // Second triangle
        indices.push(base + 1, base + 2, base + 3);
      }
    }
    
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    
    return geometry;
  }, [curve]);
  
  if (!curve || !waterGeometry) {
    return null;
  }
  
  return (
    <mesh ref={meshRef} geometry={waterGeometry} receiveShadow>
      <meshPhysicalMaterial
        color={waterConfig.color}
        metalness={0.1}
        roughness={0.12}
        transmission={0.35}
        thickness={2.0}
        ior={1.33}
        reflectivity={0.9}
        clearcoat={0.3}
        clearcoatRoughness={0.4}
        envMapIntensity={1.5}
        transparent
        opacity={0.92}
        emissive={waterConfig.emissive}
        emissiveIntensity={waterConfig.emissiveIntensity}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
};

// ============================================================================
// CURVED RIVERBANKS - Follow GPS path on both sides, outside water channel
// ============================================================================
interface CurvedRiverbanksProps {
  curve: THREE.CatmullRomCurve3 | null;
  theme: RouteTheme;
}

const CurvedRiverbanks: React.FC<CurvedRiverbanksProps> = ({ curve, theme }) => {
  // Theme-based bank colors
  const bankConfig = useMemo(() => {
    switch (theme) {
      case 'crystal-bled':
        return { color: '#6b8e4a', roughness: 0.9 };
      case 'gothic-venice':
        return { color: '#3d4a3a', roughness: 0.95 };
      case 'steampunk-henley':
        return { color: '#8b7355', roughness: 0.85 };
      case 'dystopian-thames':
        return { color: '#2a2a2a', roughness: 0.95 };
      case 'scifi-boston':
        return { color: '#1a2a3a', roughness: 0.8 };
      default:
        return { color: '#4a7c32', roughness: 0.95 };
    }
  }, [theme]);
  
  // Generate curved riverbank geometry
  const { leftBankGeometry, rightBankGeometry } = useMemo(() => {
    if (!curve) return { leftBankGeometry: null, rightBankGeometry: null };
    
    const segments = 200;
    const waterHalfWidth = WATER_CHANNEL_WIDTH / 2;
    const bankWidth = RIVERBANK_WIDTH;
    
    const createBankGeometry = (side: 'left' | 'right') => {
      const positions: number[] = [];
      const normals: number[] = [];
      const uvs: number[] = [];
      const indices: number[] = [];
      
      for (let i = 0; i <= segments; i++) {
        const t = i / segments;
        const point = curve.getPointAt(t);
        const tangent = curve.getTangentAt(t).normalize();
        
        // Perpendicular direction
        const up = new THREE.Vector3(0, 1, 0);
        const perp = new THREE.Vector3().crossVectors(tangent, up).normalize();
        
        // Inner edge (at water boundary) and outer edge
        const innerOffset = side === 'left' ? -waterHalfWidth : waterHalfWidth;
        const outerOffset = side === 'left' ? -(waterHalfWidth + bankWidth) : (waterHalfWidth + bankWidth);
        
        const inner = new THREE.Vector3().copy(point).addScaledVector(perp, innerOffset);
        const outer = new THREE.Vector3().copy(point).addScaledVector(perp, outerOffset);
        
        // Bank is at ground level
        inner.y = -0.5;
        outer.y = -0.5;
        
        // Add vertices
        positions.push(inner.x, inner.y, inner.z);
        positions.push(outer.x, outer.y, outer.z);
        
        normals.push(0, 1, 0);
        normals.push(0, 1, 0);
        
        uvs.push(0, t * 10);
        uvs.push(1, t * 10);
        
        if (i < segments) {
          const base = i * 2;
          indices.push(base, base + 2, base + 1);
          indices.push(base + 1, base + 2, base + 3);
        }
      }
      
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
      geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      geometry.setIndex(indices);
      
      return geometry;
    };
    
    return {
      leftBankGeometry: createBankGeometry('left'),
      rightBankGeometry: createBankGeometry('right')
    };
  }, [curve]);
  
  if (!curve || !leftBankGeometry || !rightBankGeometry) {
    return null;
  }
  
  return (
    <group>
      <mesh geometry={leftBankGeometry} receiveShadow>
        <meshStandardMaterial color={bankConfig.color} roughness={bankConfig.roughness} />
      </mesh>
      <mesh geometry={rightBankGeometry} receiveShadow>
        <meshStandardMaterial color={bankConfig.color} roughness={bankConfig.roughness} />
      </mesh>
    </group>
  );
};

// ============================================================================
// CURVED LANDSCAPE ELEMENTS - Trees and objects placed along curved path
// ============================================================================
interface CurvedLandscapeProps {
  curve: THREE.CatmullRomCurve3 | null;
  theme: RouteTheme;
  boatProgress: number;
}

const CurvedLandscapeElements: React.FC<CurvedLandscapeProps> = ({ curve, theme, boatProgress }) => {
  // Generate landscape element positions along the curved path
  const landscapeElements = useMemo(() => {
    if (!curve) return { leftElements: [], rightElements: [] };
    
    const leftElements: Array<{ position: THREE.Vector3; type: 'tree' | 'mountain' | 'building'; scale: number; rotation: number }> = [];
    const rightElements: Array<{ position: THREE.Vector3; type: 'tree' | 'mountain' | 'building'; scale: number; rotation: number }> = [];
    
    const elementSpacing = 0.02; // Progress spacing between elements
    const waterHalfWidth = WATER_CHANNEL_WIDTH / 2;
    const minOffset = LANDSCAPE_OFFSET; // Minimum distance from water center
    
    for (let t = 0; t < 1; t += elementSpacing) {
      const point = curve.getPointAt(t);
      const tangent = curve.getTangentAt(t).normalize();
      const up = new THREE.Vector3(0, 1, 0);
      const perp = new THREE.Vector3().crossVectors(tangent, up).normalize();
      
      // Random offset beyond the minimum landscape offset
      const leftOffset = minOffset + Math.random() * 30;
      const rightOffset = minOffset + Math.random() * 30;
      
      // Element type based on theme and randomness
      const getElementType = (): 'tree' | 'mountain' | 'building' => {
        const rand = Math.random();
        switch (theme) {
          case 'dystopian-thames':
          case 'scifi-boston':
            return rand < 0.3 ? 'building' : rand < 0.6 ? 'mountain' : 'tree';
          case 'crystal-bled':
          case 'willowbrook':
            return rand < 0.4 ? 'mountain' : 'tree';
          default:
            return rand < 0.2 ? 'building' : rand < 0.4 ? 'mountain' : 'tree';
        }
      };
      
      // Only add elements with some probability to avoid overcrowding
      if (Math.random() < 0.6) {
        const leftPos = new THREE.Vector3().copy(point).addScaledVector(perp, -leftOffset);
        leftPos.y = 0;
        leftElements.push({
          position: leftPos,
          type: getElementType(),
          scale: 0.8 + Math.random() * 0.8,
          rotation: Math.atan2(tangent.x, tangent.z) + Math.PI / 2
        });
      }
      
      if (Math.random() < 0.6) {
        const rightPos = new THREE.Vector3().copy(point).addScaledVector(perp, rightOffset);
        rightPos.y = 0;
        rightElements.push({
          position: rightPos,
          type: getElementType(),
          scale: 0.8 + Math.random() * 0.8,
          rotation: Math.atan2(tangent.x, tangent.z) - Math.PI / 2
        });
      }
    }
    
    return { leftElements, rightElements };
  }, [curve, theme]);
  
  // Get theme colors for elements
  const colors = useMemo(() => {
    switch (theme) {
      case 'crystal-bled':
        return { tree: '#2d5a3d', mountain: '#5a7247', building: '#8fa4b8' };
      case 'gothic-venice':
        return { tree: '#1a2a1a', mountain: '#3d4a3a', building: '#4a5568' };
      case 'steampunk-henley':
        return { tree: '#4a5a41', mountain: '#8b7355', building: '#b8860b' };
      case 'dystopian-thames':
        return { tree: '#1a1a1a', mountain: '#2a2a2a', building: '#4a4a4a' };
      case 'scifi-boston':
        return { tree: '#1a3a2a', mountain: '#2a3a4a', building: '#4a5a6a' };
      default:
        return { tree: '#2d5a3d', mountain: '#5a7247', building: '#8b7355' };
    }
  }, [theme]);
  
  if (!curve) return null;
  
  // Render only elements near the boat for performance
  const visibleRange = 0.15; // Show elements within 15% of path around boat
  const filteredLeft = landscapeElements.leftElements.filter((_, i) => {
    const elementProgress = i * 0.02 / 0.6; // Approximate progress
    return Math.abs(elementProgress - boatProgress) < visibleRange || elementProgress < 0.1;
  });
  const filteredRight = landscapeElements.rightElements.filter((_, i) => {
    const elementProgress = i * 0.02 / 0.6;
    return Math.abs(elementProgress - boatProgress) < visibleRange || elementProgress < 0.1;
  });
  
  const renderElement = (el: typeof landscapeElements.leftElements[0], index: number, side: string) => {
    switch (el.type) {
      case 'tree':
        return (
          <group key={`${side}-tree-${index}`} position={[el.position.x, el.position.y, el.position.z]}>
            {/* Trunk */}
            <mesh position={[0, 2 * el.scale, 0]} castShadow>
              <cylinderGeometry args={[0.3 * el.scale, 0.5 * el.scale, 4 * el.scale, 8]} />
              <meshStandardMaterial color="#4a3728" roughness={0.9} />
            </mesh>
            {/* Foliage */}
            <mesh position={[0, 5 * el.scale, 0]} castShadow>
              <coneGeometry args={[2.5 * el.scale, 6 * el.scale, 8]} />
              <meshStandardMaterial color={colors.tree} roughness={0.8} />
            </mesh>
          </group>
        );
      case 'mountain':
        return (
          <mesh 
            key={`${side}-mountain-${index}`} 
            position={[el.position.x, 8 * el.scale, el.position.z]} 
            castShadow 
            receiveShadow
          >
            <coneGeometry args={[10 * el.scale, 20 * el.scale, 6]} />
            <meshStandardMaterial color={colors.mountain} roughness={0.9} />
          </mesh>
        );
      case 'building':
        return (
          <mesh 
            key={`${side}-building-${index}`} 
            position={[el.position.x, 6 * el.scale, el.position.z]} 
            rotation={[0, el.rotation, 0]}
            castShadow
          >
            <boxGeometry args={[4 * el.scale, 12 * el.scale, 4 * el.scale]} />
            <meshStandardMaterial color={colors.building} roughness={0.7} />
          </mesh>
        );
    }
  };
  
  return (
    <group>
      {filteredLeft.map((el, i) => renderElement(el, i, 'left'))}
      {filteredRight.map((el, i) => renderElement(el, i, 'right'))}
    </group>
  );
};

// ============================================================================
// ANIMATED WATER PLANE - Creates flowing water effect (legacy fallback)
// ============================================================================
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const AnimatedWater: React.FC<{ boatZ: number }> = ({ boatZ }) => {
  const meshRef = useRef<THREE.Mesh>(null);
  const materialRef = useRef<THREE.MeshStandardMaterial>(null);
  
  useFrame((_, delta) => {
    // Animate water texture offset to simulate flow (opposite to boat movement)
    if (materialRef.current && materialRef.current.map) {
      materialRef.current.map.offset.y += delta * 0.05;
    }
  });
  
  return (
    <mesh 
      ref={meshRef}
      rotation={[-Math.PI / 2, 0, 0]} 
      position={[0, -0.1, boatZ]}
      receiveShadow
    >
      <planeGeometry args={[1000, 1000, 64, 64]} />
      <meshStandardMaterial 
        ref={materialRef}
        color="#2d7dc9"
        transparent
        opacity={0.85}
        roughness={0.8}
        metalness={0.2}
      />
    </mesh>
  );
};

// ============================================================================
// PROCEDURAL TERRAIN - Mountains along the banks
// ============================================================================
const ProceduralTerrain: React.FC<{ side: 'left' | 'right'; boatZ: number }> = ({ side, boatZ }) => {
  const xOffset = side === 'left' ? -35 : 35;
  
  // Generate mountain positions along the route
  const mountains = useMemo(() => {
    const result: Array<{ x: number; z: number; scale: number; height: number }> = [];
    for (let z = -500; z < 500; z += 40) {
      result.push({
        x: xOffset + (Math.random() - 0.5) * 10,
        z: z + (Math.random() - 0.5) * 20,
        scale: 8 + Math.random() * 12,
        height: 15 + Math.random() * 25,
      });
    }
    return result;
  }, [xOffset]);
  
  return (
    <group position={[0, 0, boatZ]}>
      {mountains.map((m, i) => (
        <mesh key={i} position={[m.x, m.height / 2 - 2, m.z]} castShadow receiveShadow>
          <coneGeometry args={[m.scale, m.height, 6]} />
          <meshStandardMaterial color="#5a7247" roughness={0.9} />
        </mesh>
      ))}
    </group>
  );
};

// ============================================================================
// PINE TREES - Scattered along the banks
// ============================================================================
const PineTrees: React.FC<{ side: 'left' | 'right'; boatZ: number }> = ({ side, boatZ }) => {
  const xBase = side === 'left' ? -25 : 25;
  
  // Generate tree positions
  const trees = useMemo(() => {
    const result: Array<{ x: number; z: number; scale: number }> = [];
    for (let z = -400; z < 400; z += 8) {
      const count = 1 + Math.floor(Math.random() * 2);
      for (let j = 0; j < count; j++) {
        result.push({
          x: xBase + (Math.random() - 0.5) * 15 + (side === 'left' ? -5 : 5),
          z: z + (Math.random() - 0.5) * 6,
          scale: 0.8 + Math.random() * 0.6,
        });
      }
    }
    return result;
  }, [xBase, side]);
  
  return (
    <group position={[0, 0, boatZ]}>
      {trees.map((tree, i) => (
        <group key={i} position={[tree.x, 0, tree.z]} scale={tree.scale}>
          {/* Tree trunk */}
          <mesh position={[0, 1, 0]} castShadow>
            <cylinderGeometry args={[0.15, 0.2, 2, 8]} />
            <meshStandardMaterial color="#4a3728" roughness={0.9} />
          </mesh>
          {/* Tree foliage - 3 stacked cones */}
          <mesh position={[0, 3, 0]} castShadow>
            <coneGeometry args={[1.2, 2.5, 8]} />
            <meshStandardMaterial color="#2d5a27" roughness={0.8} />
          </mesh>
          <mesh position={[0, 4, 0]} castShadow>
            <coneGeometry args={[0.9, 2, 8]} />
            <meshStandardMaterial color="#3a6b32" roughness={0.8} />
          </mesh>
          <mesh position={[0, 4.8, 0]} castShadow>
            <coneGeometry args={[0.6, 1.5, 8]} />
            <meshStandardMaterial color="#4a7a42" roughness={0.8} />
          </mesh>
        </group>
      ))}
    </group>
  );
};

// ============================================================================
// THEMED LANDSCAPE COMPONENTS - Replace generic scenery for fantasy routes
// ============================================================================

// CRYSTAL BLED - Ethereal floating crystal towers, bioluminescent glow
const CrystalBledLandscape: React.FC<{ side: 'left' | 'right'; boatZ: number }> = ({ side, boatZ }) => {
  const xOffset = side === 'left' ? -40 : 40;
  
  const crystals = useMemo(() => {
    const result: Array<{ x: number; z: number; height: number; radius: number; color: string }> = [];
    const colors = ['#00f5d4', '#7df9ff', '#a0e7e5', '#40e0d0', '#00ced1'];
    for (let z = -500; z < 500; z += 30) {
      result.push({
        x: xOffset + (Math.random() - 0.5) * 20,
        z: z + (Math.random() - 0.5) * 15,
        height: 12 + Math.random() * 25,
        radius: 1.5 + Math.random() * 2,
        color: colors[Math.floor(Math.random() * colors.length)],
      });
    }
    return result;
  }, [xOffset]);
  
  const mountains = useMemo(() => {
    const result: Array<{ x: number; z: number; scale: number; height: number }> = [];
    for (let z = -500; z < 500; z += 80) {
      result.push({
        x: xOffset + (side === 'left' ? -30 : 30) + (Math.random() - 0.5) * 15,
        z: z + (Math.random() - 0.5) * 30,
        scale: 20 + Math.random() * 20,
        height: 30 + Math.random() * 40,
      });
    }
    return result;
  }, [xOffset, side]);
  
  return (
    <group position={[0, 0, boatZ]}>
      {/* Crystal spires */}
      {crystals.map((c, i) => (
        <group key={i} position={[c.x, 0, c.z]}>
          {/* Main crystal */}
          <mesh position={[0, c.height / 2, 0]} castShadow>
            <cylinderGeometry args={[c.radius * 0.3, c.radius, c.height, 6]} />
            <meshStandardMaterial color={c.color} transparent opacity={0.8} emissive={c.color} emissiveIntensity={0.3} roughness={0.2} metalness={0.4} />
          </mesh>
          {/* Glow base */}
          <mesh position={[0, 0.5, 0]}>
            <cylinderGeometry args={[c.radius * 1.2, c.radius * 1.5, 1, 8]} />
            <meshStandardMaterial color={c.color} transparent opacity={0.4} emissive={c.color} emissiveIntensity={0.5} />
          </mesh>
        </group>
      ))}
      {/* Snow-capped mountains in background */}
      {mountains.map((m, i) => (
        <group key={`mtn-${i}`} position={[m.x, 0, m.z]}>
          <mesh position={[0, m.height / 2 - 2, 0]} castShadow>
            <coneGeometry args={[m.scale, m.height, 6]} />
            <meshStandardMaterial color="#6b7280" roughness={0.9} />
          </mesh>
          {/* Snow cap */}
          <mesh position={[0, m.height * 0.75, 0]}>
            <coneGeometry args={[m.scale * 0.4, m.height * 0.3, 6]} />
            <meshStandardMaterial color="#f8fafc" roughness={0.7} />
          </mesh>
        </group>
      ))}
    </group>
  );
};

// GOTHIC VENICE - Ruined palaces, spectral mist, ghostly structures
const GothicVeniceLandscape: React.FC<{ side: 'left' | 'right'; boatZ: number }> = ({ side, boatZ }) => {
  const xOffset = side === 'left' ? -25 : 25;
  
  const buildings = useMemo(() => {
    const result: Array<{ x: number; z: number; height: number; width: number; depth: number; color: string; tilt: number }> = [];
    const colors = ['#2d3436', '#1e272e', '#2c3e50', '#34495e', '#192a56'];
    for (let z = -400; z < 400; z += 20) {
      result.push({
        x: xOffset + (Math.random() - 0.5) * 12,
        z: z + (Math.random() - 0.5) * 10,
        height: 8 + Math.random() * 14,
        width: 4 + Math.random() * 6,
        depth: 4 + Math.random() * 5,
        color: colors[Math.floor(Math.random() * colors.length)],
        tilt: (Math.random() - 0.5) * 0.15, // Slightly tilted ruins
      });
    }
    return result;
  }, [xOffset]);
  
  return (
    <group position={[0, 0, boatZ]}>
      {buildings.map((b, i) => (
        <group key={i} position={[b.x, 0, b.z]} rotation={[0, 0, b.tilt]}>
          {/* Ruined palazzo */}
          <mesh position={[0, b.height / 2, 0]} castShadow>
            <boxGeometry args={[b.width, b.height, b.depth]} />
            <meshStandardMaterial color={b.color} roughness={0.9} />
          </mesh>
          {/* Gothic window arches */}
          {[0.3, 0.5, 0.7].map((yPos, j) => (
            <mesh key={j} position={[b.width / 2 + 0.01, b.height * yPos, 0]}>
              <boxGeometry args={[0.1, 1.5, b.depth * 0.6]} />
              <meshStandardMaterial color="#0a3d62" emissive="#0a3d62" emissiveIntensity={0.2} transparent opacity={0.6} />
            </mesh>
          ))}
          {/* Crumbling top */}
          <mesh position={[(Math.random() - 0.5) * b.width * 0.3, b.height + 0.5, 0]}>
            <boxGeometry args={[b.width * 0.4, 1, b.depth * 0.4]} />
            <meshStandardMaterial color={b.color} roughness={0.95} />
          </mesh>
        </group>
      ))}
    </group>
  );
};

// STEAMPUNK HENLEY - Brass towers, clockwork mechanisms, steam vents
const SteampunkHenleyLandscape: React.FC<{ side: 'left' | 'right'; boatZ: number }> = ({ side, boatZ }) => {
  const xOffset = side === 'left' ? -30 : 30;
  
  const structures = useMemo(() => {
    const result: Array<{ x: number; z: number; height: number; type: 'tower' | 'platform' | 'gear' }> = [];
    for (let z = -400; z < 400; z += 25) {
      const type = Math.random() > 0.6 ? 'tower' : (Math.random() > 0.5 ? 'platform' : 'gear');
      result.push({
        x: xOffset + (Math.random() - 0.5) * 15,
        z: z + (Math.random() - 0.5) * 12,
        height: 8 + Math.random() * 18,
        type,
      });
    }
    return result;
  }, [xOffset]);
  
  return (
    <group position={[0, 0, boatZ]}>
      {structures.map((s, i) => (
        <group key={i} position={[s.x, 0, s.z]}>
          {s.type === 'tower' && (
            <>
              {/* Brass tower */}
              <mesh position={[0, s.height / 2, 0]} castShadow>
                <cylinderGeometry args={[2, 3, s.height, 8]} />
                <meshStandardMaterial color="#b87333" metalness={0.6} roughness={0.4} />
              </mesh>
              {/* Copper dome top */}
              <mesh position={[0, s.height + 1, 0]}>
                <sphereGeometry args={[2.5, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2]} />
                <meshStandardMaterial color="#cd7f32" metalness={0.7} roughness={0.3} />
              </mesh>
              {/* Steam vent */}
              <mesh position={[0, s.height + 3, 0]}>
                <cylinderGeometry args={[0.3, 0.5, 2, 6]} />
                <meshStandardMaterial color="#8b7355" metalness={0.5} roughness={0.5} />
              </mesh>
            </>
          )}
          {s.type === 'platform' && (
            <>
              {/* Iron platform */}
              <mesh position={[0, s.height * 0.3, 0]} castShadow>
                <boxGeometry args={[8, 1, 6]} />
                <meshStandardMaterial color="#8b7355" metalness={0.4} roughness={0.6} />
              </mesh>
              {/* Support legs */}
              {[[-3, -2], [-3, 2], [3, -2], [3, 2]].map(([x, z], j) => (
                <mesh key={j} position={[x, s.height * 0.15, z]}>
                  <cylinderGeometry args={[0.3, 0.4, s.height * 0.3, 6]} />
                  <meshStandardMaterial color="#6b5344" metalness={0.3} roughness={0.7} />
                </mesh>
              ))}
            </>
          )}
          {s.type === 'gear' && (
            <>
              {/* Giant gear */}
              <mesh position={[0, s.height * 0.4, 0]} rotation={[Math.PI / 2, 0, 0]}>
                <torusGeometry args={[4, 0.8, 8, 16]} />
                <meshStandardMaterial color="#daa520" metalness={0.7} roughness={0.3} />
              </mesh>
              {/* Gear center */}
              <mesh position={[0, s.height * 0.4, 0]} rotation={[Math.PI / 2, 0, 0]}>
                <cylinderGeometry args={[2, 2, 1, 8]} />
                <meshStandardMaterial color="#cd853f" metalness={0.6} roughness={0.4} />
              </mesh>
            </>
          )}
        </group>
      ))}
    </group>
  );
};

// DYSTOPIAN THAMES - Ruined skyscrapers, military fortifications, fog
const DystopianThamesLandscape: React.FC<{ side: 'left' | 'right'; boatZ: number }> = ({ side, boatZ }) => {
  const xOffset = side === 'left' ? -35 : 35;
  
  const ruins = useMemo(() => {
    const result: Array<{ x: number; z: number; height: number; width: number; damaged: boolean }> = [];
    const colors = ['#1a1a2e', '#16213e', '#0f3460', '#162447'];
    for (let z = -500; z < 500; z += 30) {
      result.push({
        x: xOffset + (Math.random() - 0.5) * 20,
        z: z + (Math.random() - 0.5) * 15,
        height: 15 + Math.random() * 35,
        width: 4 + Math.random() * 6,
        damaged: Math.random() > 0.4,
      });
    }
    return result;
  }, [xOffset]);
  
  return (
    <group position={[0, 0, boatZ]}>
      {ruins.map((r, i) => (
        <group key={i} position={[r.x, 0, r.z]}>
          {/* Ruined skyscraper */}
          <mesh position={[0, (r.damaged ? r.height * 0.7 : r.height) / 2, 0]} castShadow>
            <boxGeometry args={[r.width, r.damaged ? r.height * 0.7 : r.height, r.width]} />
            <meshStandardMaterial color="#1a1a2e" roughness={0.9} />
          </mesh>
          {/* Dark windows */}
          {[0.2, 0.4, 0.6, 0.8].map((yPos, j) => (
            <mesh key={j} position={[r.width / 2 + 0.01, (r.damaged ? r.height * 0.7 : r.height) * yPos, 0]}>
              <boxGeometry args={[0.1, 1, r.width * 0.7]} />
              <meshStandardMaterial color="#0f3460" emissive="#ff006e" emissiveIntensity={Math.random() > 0.7 ? 0.3 : 0} />
            </mesh>
          ))}
          {/* Damage debris */}
          {r.damaged && (
            <mesh position={[(Math.random() - 0.5) * r.width, r.height * 0.35 + 1, (Math.random() - 0.5) * r.width]}>
              <boxGeometry args={[r.width * 0.3, 2, r.width * 0.3]} />
              <meshStandardMaterial color="#16213e" roughness={0.95} />
            </mesh>
          )}
          {/* Searchlight on some buildings */}
          {Math.random() > 0.7 && (
            <mesh position={[0, r.height + 2, 0]}>
              <cylinderGeometry args={[0.2, 0.4, 3, 6]} />
              <meshStandardMaterial color="#ffd60a" emissive="#ffd60a" emissiveIntensity={0.5} />
            </mesh>
          )}
        </group>
      ))}
    </group>
  );
};

// SCI-FI BOSTON - Geometric impossibilities, tesseract architecture, glowing structures
const SciFiBostonLandscape: React.FC<{ side: 'left' | 'right'; boatZ: number }> = ({ side, boatZ }) => {
  const xOffset = side === 'left' ? -35 : 35;
  
  const structures = useMemo(() => {
    const result: Array<{ x: number; z: number; height: number; type: 'tower' | 'cube' | 'pyramid' }> = [];
    for (let z = -500; z < 500; z += 28) {
      const type = Math.random() > 0.6 ? 'tower' : (Math.random() > 0.5 ? 'cube' : 'pyramid');
      result.push({
        x: xOffset + (Math.random() - 0.5) * 18,
        z: z + (Math.random() - 0.5) * 14,
        height: 10 + Math.random() * 25,
        type,
      });
    }
    return result;
  }, [xOffset]);
  
  const colors = ['#00f5d4', '#7df9ff', '#40e0d0', '#00ced1', '#48d1cc'];
  
  return (
    <group position={[0, 0, boatZ]}>
      {structures.map((s, i) => {
        const color = colors[i % colors.length];
        return (
          <group key={i} position={[s.x, 0, s.z]}>
            {s.type === 'tower' && (
              <>
                {/* Holographic tower */}
                <mesh position={[0, s.height / 2, 0]} castShadow>
                  <boxGeometry args={[3, s.height, 3]} />
                  <meshStandardMaterial color={color} transparent opacity={0.7} emissive={color} emissiveIntensity={0.4} metalness={0.8} roughness={0.1} />
                </mesh>
                {/* Antenna */}
                <mesh position={[0, s.height + 2, 0]}>
                  <cylinderGeometry args={[0.1, 0.2, 4, 4]} />
                  <meshStandardMaterial color="#ffd60a" emissive="#ffd60a" emissiveIntensity={0.6} />
                </mesh>
              </>
            )}
            {s.type === 'cube' && (
              <>
                {/* Floating tesseract cube */}
                <mesh position={[0, s.height * 0.5 + 3, 0]} rotation={[Math.PI / 6, Math.PI / 4, 0]}>
                  <boxGeometry args={[5, 5, 5]} />
                  <meshStandardMaterial color={color} transparent opacity={0.6} emissive={color} emissiveIntensity={0.5} wireframe />
                </mesh>
                <mesh position={[0, s.height * 0.5 + 3, 0]} rotation={[Math.PI / 4, Math.PI / 6, 0]}>
                  <boxGeometry args={[3.5, 3.5, 3.5]} />
                  <meshStandardMaterial color={color} transparent opacity={0.4} emissive={color} emissiveIntensity={0.3} />
                </mesh>
              </>
            )}
            {s.type === 'pyramid' && (
              <>
                {/* Inverted pyramid */}
                <mesh position={[0, s.height * 0.5, 0]} rotation={[Math.PI, 0, 0]}>
                  <coneGeometry args={[4, s.height * 0.6, 4]} />
                  <meshStandardMaterial color={color} transparent opacity={0.7} emissive={color} emissiveIntensity={0.3} metalness={0.7} roughness={0.2} />
                </mesh>
                {/* Base platform */}
                <mesh position={[0, s.height * 0.8, 0]}>
                  <boxGeometry args={[6, 1, 6]} />
                  <meshStandardMaterial color="#162447" metalness={0.5} roughness={0.4} />
                </mesh>
              </>
            )}
          </group>
        );
      })}
    </group>
  );
};

// ============================================================================
// THEMED RIVERBANKS - Ground color varies by route theme
// ============================================================================
const ThemedRiverbanks: React.FC<{ boatZ: number; theme: RouteTheme }> = ({ boatZ, theme }) => {
  const bankColor = useMemo(() => {
    switch (theme) {
      case 'crystal-bled': return '#2d5a27'; // Lush alpine green
      case 'gothic-venice': return '#1e272e'; // Dark stone quay
      case 'steampunk-henley': return '#5d4e37'; // Industrial brown
      case 'dystopian-thames': return '#1a1a2e'; // Dark concrete
      case 'scifi-boston': return '#0f172a'; // Dark tech surface
      default: return '#4a7c32'; // Standard grass
    }
  }, [theme]);
  
  return (
    <group position={[0, -0.5, boatZ]}>
      <mesh position={[-40, 0, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[60, 1000]} />
        <meshStandardMaterial color={bankColor} roughness={0.95} />
      </mesh>
      <mesh position={[40, 0, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[60, 1000]} />
        <meshStandardMaterial color={bankColor} roughness={0.95} />
      </mesh>
    </group>
  );
};

// ============================================================================
// THEMED WATER - Water color varies by route theme (legacy - now uses PhotorealisticWater)
// ============================================================================
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const ThemedWater: React.FC<{ boatZ: number; theme: RouteTheme }> = ({ boatZ, theme }) => {
  const meshRef = useRef<THREE.Mesh>(null);
  const materialRef = useRef<THREE.MeshStandardMaterial>(null);
  
  const waterColor = useMemo(() => {
    switch (theme) {
      case 'crystal-bled': return '#00d9ff'; // Bioluminescent cyan
      case 'gothic-venice': return '#0a3d62'; // Dark spectral green
      case 'steampunk-henley': return '#4a6741'; // Murky industrial
      case 'dystopian-thames': return '#162447'; // Toxic dark blue
      case 'scifi-boston': return '#00ced1'; // Glowing teal
      default: return '#2d7dc9'; // Standard water blue
    }
  }, [theme]);
  
  const emissiveIntensity = theme === 'crystal-bled' || theme === 'scifi-boston' ? 0.15 : 0;
  
  useFrame((_, delta) => {
    if (materialRef.current && materialRef.current.map) {
      materialRef.current.map.offset.y += delta * 0.05;
    }
  });
  
  return (
    <mesh ref={meshRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.1, boatZ]} receiveShadow>
      <planeGeometry args={[1000, 1000, 64, 64]} />
      <meshStandardMaterial 
        ref={materialRef}
        color={waterColor}
        transparent
        opacity={0.85}
        roughness={0.8}
        metalness={0.2}
        emissive={waterColor}
        emissiveIntensity={emissiveIntensity}
      />
    </mesh>
  );
};

// ============================================================================
// THEMED SKY/FOG - Atmosphere varies by route theme  
// ============================================================================
const getThemeAtmosphere = (theme: RouteTheme) => {
  switch (theme) {
    case 'crystal-bled':
      return { fogColor: '#a0cdfa', fogNear: 50, fogFar: 600, skyColor: '#87ceeb' }; // Clear alpine
    case 'gothic-venice':
      return { fogColor: '#2c3e50', fogNear: 20, fogFar: 300, skyColor: '#1e272e' }; // Heavy mist
    case 'steampunk-henley':
      return { fogColor: '#8b7355', fogNear: 40, fogFar: 400, skyColor: '#c9a227' }; // Sepia steam
    case 'dystopian-thames':
      return { fogColor: '#1a1a2e', fogNear: 30, fogFar: 350, skyColor: '#0f172a' }; // Toxic smog
    case 'scifi-boston':
      return { fogColor: '#0f172a', fogNear: 60, fogFar: 500, skyColor: '#162447' }; // Neon night
    default:
      return { fogColor: '#a0cdfa', fogNear: 50, fogFar: 500, skyColor: '#a0cdfa' }; // Default
  }
};

// ============================================================================
// SKY CONFIGURATION - Sun position and atmosphere by theme
// ============================================================================
interface SkyConfig {
  sunPosition: [number, number, number];
  turbidity: number;         // Haziness (1-20, lower is clearer)
  rayleigh: number;          // Sky blue scattering (0-4)
  mieCoefficient: number;    // Particle scattering (0-0.1)
  mieDirectionalG: number;   // Sun glow direction (0-1)
  inclination: number;       // Sun elevation (0-1, 0.5 = horizon)
  azimuth: number;           // Sun compass direction (0-1)
  exposure: number;          // Overall brightness
}

const getSkyConfig = (theme: RouteTheme): SkyConfig => {
  switch (theme) {
    case 'crystal-bled':
      // Clear alpine morning - bright blue sky, high sun
      return {
        sunPosition: [100, 80, 50],
        turbidity: 1.5,
        rayleigh: 2.0,
        mieCoefficient: 0.005,
        mieDirectionalG: 0.8,
        inclination: 0.65,
        azimuth: 0.25,
        exposure: 0.5
      };
    case 'gothic-venice':
      // Overcast twilight - low sun, heavy atmosphere
      return {
        sunPosition: [50, 15, -100],
        turbidity: 10,
        rayleigh: 3.0,
        mieCoefficient: 0.05,
        mieDirectionalG: 0.95,
        inclination: 0.35,
        azimuth: 0.75,
        exposure: 0.3
      };
    case 'steampunk-henley':
      // Golden hour - warm sunset colors, dusty atmosphere
      return {
        sunPosition: [80, 25, 60],
        turbidity: 8,
        rayleigh: 1.5,
        mieCoefficient: 0.03,
        mieDirectionalG: 0.9,
        inclination: 0.42,
        azimuth: 0.15,
        exposure: 0.45
      };
    case 'dystopian-thames':
      // Polluted dusk - red/orange haze, obscured sun
      return {
        sunPosition: [30, 8, -80],
        turbidity: 20,
        rayleigh: 0.5,
        mieCoefficient: 0.1,
        mieDirectionalG: 0.99,
        inclination: 0.28,
        azimuth: 0.85,
        exposure: 0.25
      };
    case 'scifi-boston':
      // Night with artificial light - moon-like glow
      return {
        sunPosition: [-50, 60, 100],
        turbidity: 0.5,
        rayleigh: 0.2,
        mieCoefficient: 0.001,
        mieDirectionalG: 0.7,
        inclination: 0.58,
        azimuth: 0.6,
        exposure: 0.2
      };
    default: // willowbrook - realistic overcast morning
      return {
        sunPosition: [80, 50, 30],
        turbidity: 4,
        rayleigh: 2.5,
        mieCoefficient: 0.01,
        mieDirectionalG: 0.85,
        inclination: 0.55,
        azimuth: 0.2,
        exposure: 0.4
      };
  }
};

// Cloud configuration by theme
interface CloudConfig {
  enabled: boolean;
  count: number;
  opacity: number;
  speed: number;
  color: string;
  segments: number;
}

const getCloudConfig = (theme: RouteTheme): CloudConfig => {
  switch (theme) {
    case 'crystal-bled':
      return { enabled: true, count: 15, opacity: 0.6, speed: 0.2, color: '#ffffff', segments: 30 };
    case 'gothic-venice':
      return { enabled: true, count: 25, opacity: 0.9, speed: 0.1, color: '#4a5568', segments: 40 };
    case 'steampunk-henley':
      return { enabled: true, count: 20, opacity: 0.7, speed: 0.15, color: '#d4a574', segments: 35 };
    case 'dystopian-thames':
      return { enabled: true, count: 30, opacity: 0.95, speed: 0.08, color: '#2d3436', segments: 45 };
    case 'scifi-boston':
      return { enabled: false, count: 5, opacity: 0.3, speed: 0.3, color: '#1e3a5f', segments: 20 };
    default:
      return { enabled: true, count: 18, opacity: 0.5, speed: 0.2, color: '#e8e8e8', segments: 30 };
  }
};

// ============================================================================
// PHOTOREALISTIC SKYDOME - Physically-based sky with sun, clouds, atmosphere
// ============================================================================
const PhotorealisticSkydome: React.FC<{ theme: RouteTheme; boatZ: number }> = ({ theme, boatZ }) => {
  const skyConfig = useMemo(() => getSkyConfig(theme), [theme]);
  const cloudConfig = useMemo(() => getCloudConfig(theme), [theme]);
  
  // Cloud positions - spread around the sky, moving with time
  const cloudPositions = useMemo(() => {
    const positions: Array<{ x: number; y: number; z: number; scale: number }> = [];
    for (let i = 0; i < cloudConfig.count; i++) {
      const angle = (i / cloudConfig.count) * Math.PI * 2;
      const radius = 150 + Math.random() * 200;
      const height = 60 + Math.random() * 80;
      positions.push({
        x: Math.cos(angle) * radius,
        y: height,
        z: Math.sin(angle) * radius,
        scale: 15 + Math.random() * 25
      });
    }
    return positions;
  }, [cloudConfig.count]);
  
  // Animate clouds drifting
  const cloudGroupRef = useRef<THREE.Group>(null);
  useFrame((state) => {
    if (cloudGroupRef.current) {
      // Slow rotation of cloud layer
      cloudGroupRef.current.rotation.y = state.clock.elapsedTime * cloudConfig.speed * 0.01;
    }
  });
  
  return (
    <group>
      {/* Physically-based sky with atmospheric scattering */}
      <Sky
        distance={450000}
        sunPosition={skyConfig.sunPosition}
        turbidity={skyConfig.turbidity}
        rayleigh={skyConfig.rayleigh}
        mieCoefficient={skyConfig.mieCoefficient}
        mieDirectionalG={skyConfig.mieDirectionalG}
      />
      
      {/* Volumetric cloud layer */}
      {cloudConfig.enabled && (
        <group ref={cloudGroupRef} position={[0, 0, boatZ]}>
          {cloudPositions.map((pos, i) => (
            <Cloud
              key={i}
              position={[pos.x, pos.y, pos.z]}
              opacity={cloudConfig.opacity * (0.7 + Math.random() * 0.3)}
              speed={cloudConfig.speed}
              segments={cloudConfig.segments}
              color={cloudConfig.color}
              scale={pos.scale}
              depthWrite={false}
            />
          ))}
        </group>
      )}
      
      {/* Secondary distant cloud layer for depth */}
      {cloudConfig.enabled && (
        <group position={[0, 120, boatZ - 200]}>
          {[...Array(5)].map((_, i) => (
            <Cloud
              key={`distant-${i}`}
              position={[
                (i - 2) * 150,
                0,
                -100 + Math.random() * 50
              ]}
              opacity={cloudConfig.opacity * 0.4}
              speed={cloudConfig.speed * 0.5}
              segments={20}
              color={cloudConfig.color}
              scale={40 + Math.random() * 30}
              depthWrite={false}
            />
          ))}
        </group>
      )}
    </group>
  );
};

// ============================================================================
// RIVERBANKS - Ground along the sides
// ============================================================================
const Riverbanks: React.FC<{ boatZ: number }> = ({ boatZ }) => {
  return (
    <group position={[0, -0.5, boatZ]}>
      {/* Left bank */}
      <mesh position={[-40, 0, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[60, 1000]} />
        <meshStandardMaterial color="#4a7c32" roughness={0.95} />
      </mesh>
      {/* Right bank */}
      <mesh position={[40, 0, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[60, 1000]} />
        <meshStandardMaterial color="#4a7c32" roughness={0.95} />
      </mesh>
    </group>
  );
};

// ============================================================================
// ROWING SCULL (BOAT) with animated oars
// ============================================================================
const RowingScull: React.FC<{ 
  position: [number, number, number]; 
  rotation?: [number, number, number];
  cadence: number;
}> = ({ position, rotation = [0, 0, 0], cadence }) => {
  const leftOarRef = useRef<THREE.Group>(null);
  const rightOarRef = useRef<THREE.Group>(null);
  const rowerRef = useRef<THREE.Group>(null);
  
  // Body part refs for animation
  const torsoRef = useRef<THREE.Group>(null);
  const headRef = useRef<THREE.Mesh>(null);
  const leftUpperArmRef = useRef<THREE.Group>(null);
  const rightUpperArmRef = useRef<THREE.Group>(null);
  const leftForearmRef = useRef<THREE.Group>(null);
  const rightForearmRef = useRef<THREE.Group>(null);
  const leftThighRef = useRef<THREE.Group>(null);
  const rightThighRef = useRef<THREE.Group>(null);
  const leftShinRef = useRef<THREE.Group>(null);
  const rightShinRef = useRef<THREE.Group>(null);
  const seatRef = useRef<THREE.Mesh>(null);
  
  useFrame(() => {
    // Animate based on cadence
    const strokesPerMinute = Math.max(18, cadence || 24);
    const freqHz = strokesPerMinute / 60;
    const time = performance.now() * 0.001;
    const phase = (time * freqHz % 1);
    
    // Rowing stroke phases:
    // 0.0-0.4: Drive (push with legs, pull with arms, body swings back)
    // 0.4-1.0: Recovery (arms extend, body leans forward, legs compress)
    
    // Smooth easing function
    const easeInOut = (t: number) => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    
    let drivePhase: number;
    let legCompression: number;
    let armPull: number;
    let bodyLean: number;
    let seatPosition: number;
    
    if (phase < 0.4) {
      // Drive phase - legs extend, arms pull, body swings back
      const t = easeInOut(phase / 0.4);
      drivePhase = t;
      legCompression = 1 - t; // 1 (compressed) -> 0 (extended)
      armPull = t; // 0 (arms extended) -> 1 (arms pulled in)
      bodyLean = -0.3 + t * 0.5; // lean forward -> lean back
      seatPosition = -0.5 + t * 0.5; // back -> forward on slide
    } else {
      // Recovery phase - legs compress, arms extend, body leans forward
      const t = easeInOut((phase - 0.4) / 0.6);
      drivePhase = 1 - t;
      legCompression = t; // 0 (extended) -> 1 (compressed)
      armPull = 1 - t; // 1 (arms pulled in) -> 0 (arms extended)
      bodyLean = 0.2 - t * 0.5; // lean back -> lean forward
      seatPosition = t * -0.5; // forward -> back on slide
    }
    
    // Oar sweep angle
    const oarSweep = Math.sin(phase * Math.PI * 2) * 0.5;
    
    if (leftOarRef.current) leftOarRef.current.rotation.y = oarSweep;
    if (rightOarRef.current) rightOarRef.current.rotation.y = -oarSweep;
    
    // Expose oar angle and stroke rate for Playwright e2e testing
    try {
      if ((window as any).__PLAYWRIGHT_TESTING) {
        (window as any).__ROWER3D_OAR_ANGLE = oarSweep;
        (window as any).__ROWER3D_STROKE_RATE = strokesPerMinute;
      }
    } catch {}
    
    // Animate rower body
    if (torsoRef.current) {
      torsoRef.current.rotation.x = bodyLean;
    }
    
    if (headRef.current) {
      // Head stays relatively level
      headRef.current.rotation.x = -bodyLean * 0.3;
    }
    
    // Seat slides on the track
    if (seatRef.current) {
      seatRef.current.position.z = seatPosition;
    }
    
    // Leg animation - thighs rotate at hip
    const thighAngle = -0.3 + legCompression * 1.0; // More compressed = more angled
    const shinAngle = 0.2 + legCompression * 1.2; // Shin follows thigh
    
    if (leftThighRef.current) leftThighRef.current.rotation.x = thighAngle;
    if (rightThighRef.current) rightThighRef.current.rotation.x = thighAngle;
    if (leftShinRef.current) leftShinRef.current.rotation.x = shinAngle;
    if (rightShinRef.current) rightShinRef.current.rotation.x = shinAngle;
    
    // Arm animation
    const upperArmAngle = -0.5 + armPull * 1.2; // Reach forward -> pull back
    const forearmAngle = 0.3 + armPull * 0.8; // Extend -> bend at elbow
    
    if (leftUpperArmRef.current) leftUpperArmRef.current.rotation.x = upperArmAngle;
    if (rightUpperArmRef.current) rightUpperArmRef.current.rotation.x = upperArmAngle;
    if (leftForearmRef.current) leftForearmRef.current.rotation.x = forearmAngle;
    if (rightForearmRef.current) rightForearmRef.current.rotation.x = forearmAngle;
  });
  
  // Skin tone and athletic wear colors
  const skinColor = "#e0b89d";
  const hairColor = "#3d2314";
  const shirtColor = "#1e40af";
  const shortsColor = "#1e3a5f";
  
  return (
    <group position={position} rotation={rotation}>
      {/* Main hull - long narrow racing shell with fiberglass finish */}
      <mesh castShadow>
        <boxGeometry args={[0.45, 0.15, 8]} />
        <meshPhysicalMaterial 
          color="#e8d78a"           // Cream/yellow fiberglass
          metalness={0.0}
          roughness={0.15}
          clearcoat={1.0}           // Glossy gel coat finish
          clearcoatRoughness={0.05} // Very smooth clearcoat
          reflectivity={0.8}
          envMapIntensity={1.2}
          sheen={0.3}
          sheenColor="#ffffff"
        />
      </mesh>
      
      {/* Hull deck detail */}
      <mesh position={[0, 0.08, 0]} castShadow>
        <boxGeometry args={[0.4, 0.02, 7.5]} />
        <meshPhysicalMaterial 
          color="#f5eacc" 
          metalness={0.0} 
          roughness={0.2}
          clearcoat={0.8}
          clearcoatRoughness={0.1}
        />
      </mesh>
      
      {/* Bow (front) - pointed cone toward -Z */}
      <mesh position={[0, 0, -4.2]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <coneGeometry args={[0.22, 1.0, 12]} />
        <meshPhysicalMaterial 
          color="#e8d78a" 
          metalness={0.0} 
          roughness={0.15}
          clearcoat={1.0}
          clearcoatRoughness={0.05}
          reflectivity={0.8}
        />
      </mesh>
      
      {/* Stern (back) - tapered toward +Z */}
      <mesh position={[0, 0, 4]} rotation={[-Math.PI / 2, 0, 0]} castShadow>
        <coneGeometry args={[0.2, 0.8, 12]} />
        <meshPhysicalMaterial 
          color="#e8d78a" 
          metalness={0.0} 
          roughness={0.15}
          clearcoat={1.0}
          clearcoatRoughness={0.05}
          reflectivity={0.8}
        />
      </mesh>
      
      {/* Sliding seat track */}
      <mesh position={[0, 0.12, 0]}>
        <boxGeometry args={[0.25, 0.02, 1.2]} />
        <meshStandardMaterial color="#444444" metalness={0.7} roughness={0.3} />
      </mesh>
      
      {/* Sliding seat */}
      <mesh ref={seatRef} position={[0, 0.18, 0]} castShadow>
        <boxGeometry args={[0.22, 0.04, 0.2]} />
        <meshStandardMaterial color="#333333" metalness={0.5} roughness={0.4} />
      </mesh>
      
      {/* Foot stretchers */}
      <mesh position={[0, 0.15, -0.6]} rotation={[0.4, 0, 0]}>
        <boxGeometry args={[0.35, 0.03, 0.25]} />
        <meshStandardMaterial color="#222222" />
      </mesh>
      
      {/* ============================================ */}
      {/* REALISTIC HUMANOID ROWER */}
      {/* ============================================ */}
      <group ref={rowerRef} position={[0, 0.35, 0]}>
        
        {/* TORSO GROUP - rotates for body swing */}
        <group ref={torsoRef} position={[0, 0.15, 0]}>
          
          {/* Lower torso / hips */}
          <mesh position={[0, 0, 0]} castShadow>
            <boxGeometry args={[0.28, 0.15, 0.18]} />
            <meshStandardMaterial color={shortsColor} />
          </mesh>
          
          {/* Mid torso / abdomen */}
          <mesh position={[0, 0.12, 0]} castShadow>
            <boxGeometry args={[0.26, 0.12, 0.16]} />
            <meshStandardMaterial color={shirtColor} />
          </mesh>
          
          {/* Upper torso / chest */}
          <mesh position={[0, 0.26, 0]} castShadow>
            <boxGeometry args={[0.32, 0.16, 0.18]} />
            <meshStandardMaterial color={shirtColor} />
          </mesh>
          
          {/* Shoulders */}
          <mesh position={[0, 0.36, 0]} castShadow>
            <boxGeometry args={[0.4, 0.08, 0.14]} />
            <meshStandardMaterial color={shirtColor} />
          </mesh>
          
          {/* Neck */}
          <mesh position={[0, 0.44, 0]} castShadow>
            <cylinderGeometry args={[0.05, 0.06, 0.08, 12]} />
            <meshStandardMaterial color={skinColor} />
          </mesh>
          
          {/* HEAD */}
          <group position={[0, 0.56, 0]}>
            {/* Head - ellipsoid shape */}
            <mesh ref={headRef} castShadow>
              <sphereGeometry args={[0.1, 16, 16]} />
              <meshStandardMaterial color={skinColor} />
            </mesh>
            
            {/* Hair */}
            <mesh position={[0, 0.04, -0.02]} castShadow>
              <sphereGeometry args={[0.095, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.6]} />
              <meshStandardMaterial color={hairColor} />
            </mesh>
            
            {/* Face features - subtle */}
            {/* Nose */}
            <mesh position={[0, -0.01, 0.09]}>
              <boxGeometry args={[0.02, 0.03, 0.02]} />
              <meshStandardMaterial color={skinColor} />
            </mesh>
            
            {/* Eyes */}
            <mesh position={[-0.03, 0.02, 0.085]}>
              <sphereGeometry args={[0.012, 8, 8]} />
              <meshStandardMaterial color="#2c1810" />
            </mesh>
            <mesh position={[0.03, 0.02, 0.085]}>
              <sphereGeometry args={[0.012, 8, 8]} />
              <meshStandardMaterial color="#2c1810" />
            </mesh>
            
            {/* Ears */}
            <mesh position={[-0.1, 0, 0]}>
              <sphereGeometry args={[0.025, 8, 8]} />
              <meshStandardMaterial color={skinColor} />
            </mesh>
            <mesh position={[0.1, 0, 0]}>
              <sphereGeometry args={[0.025, 8, 8]} />
              <meshStandardMaterial color={skinColor} />
            </mesh>
          </group>
          
          {/* LEFT ARM */}
          <group ref={leftUpperArmRef} position={[-0.22, 0.32, 0]}>
            {/* Upper arm */}
            <mesh position={[0, -0.1, 0]} castShadow>
              <capsuleGeometry args={[0.035, 0.15, 8, 12]} />
              <meshStandardMaterial color={skinColor} />
            </mesh>
            
            {/* Forearm group - pivots at elbow */}
            <group ref={leftForearmRef} position={[0, -0.2, 0]}>
              <mesh position={[0, -0.1, 0]} castShadow>
                <capsuleGeometry args={[0.03, 0.14, 8, 12]} />
                <meshStandardMaterial color={skinColor} />
              </mesh>
              
              {/* Hand */}
              <mesh position={[0, -0.22, 0]} castShadow>
                <sphereGeometry args={[0.035, 8, 8]} />
                <meshStandardMaterial color={skinColor} />
              </mesh>
            </group>
          </group>
          
          {/* RIGHT ARM */}
          <group ref={rightUpperArmRef} position={[0.22, 0.32, 0]}>
            {/* Upper arm */}
            <mesh position={[0, -0.1, 0]} castShadow>
              <capsuleGeometry args={[0.035, 0.15, 8, 12]} />
              <meshStandardMaterial color={skinColor} />
            </mesh>
            
            {/* Forearm group - pivots at elbow */}
            <group ref={rightForearmRef} position={[0, -0.2, 0]}>
              <mesh position={[0, -0.1, 0]} castShadow>
                <capsuleGeometry args={[0.03, 0.14, 8, 12]} />
                <meshStandardMaterial color={skinColor} />
              </mesh>
              
              {/* Hand */}
              <mesh position={[0, -0.22, 0]} castShadow>
                <sphereGeometry args={[0.035, 8, 8]} />
                <meshStandardMaterial color={skinColor} />
              </mesh>
            </group>
          </group>
        </group>
        
        {/* LEGS - attached to hips, independent of torso rotation */}
        {/* LEFT LEG */}
        <group ref={leftThighRef} position={[-0.08, 0.1, 0]}>
          {/* Thigh */}
          <mesh position={[0, 0, 0.12]} rotation={[Math.PI/2, 0, 0]} castShadow>
            <capsuleGeometry args={[0.05, 0.22, 8, 12]} />
            <meshStandardMaterial color={shortsColor} />
          </mesh>
          
          {/* Shin group - pivots at knee */}
          <group ref={leftShinRef} position={[0, 0, 0.28]}>
            <mesh position={[0, 0, 0.12]} rotation={[Math.PI/2, 0, 0]} castShadow>
              <capsuleGeometry args={[0.04, 0.2, 8, 12]} />
              <meshStandardMaterial color={skinColor} />
            </mesh>
            
            {/* Foot */}
            <mesh position={[0, -0.02, 0.3]} castShadow>
              <boxGeometry args={[0.06, 0.03, 0.12]} />
              <meshStandardMaterial color="#222222" />
            </mesh>
          </group>
        </group>
        
        {/* RIGHT LEG */}
        <group ref={rightThighRef} position={[0.08, 0.1, 0]}>
          {/* Thigh */}
          <mesh position={[0, 0, 0.12]} rotation={[Math.PI/2, 0, 0]} castShadow>
            <capsuleGeometry args={[0.05, 0.22, 8, 12]} />
            <meshStandardMaterial color={shortsColor} />
          </mesh>
          
          {/* Shin group - pivots at knee */}
          <group ref={rightShinRef} position={[0, 0, 0.28]}>
            <mesh position={[0, 0, 0.12]} rotation={[Math.PI/2, 0, 0]} castShadow>
              <capsuleGeometry args={[0.04, 0.2, 8, 12]} />
              <meshStandardMaterial color={skinColor} />
            </mesh>
            
            {/* Foot */}
            <mesh position={[0, -0.02, 0.3]} castShadow>
              <boxGeometry args={[0.06, 0.03, 0.12]} />
              <meshStandardMaterial color="#222222" />
            </mesh>
          </group>
        </group>
      </group>
      
      {/* Left oar group */}
      <group ref={leftOarRef} position={[-0.3, 0.15, 0.5]}>
        {/* Rigger - metal outrigger */}
        <mesh position={[-0.6, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.025, 0.025, 1.2, 12]} />
          <meshPhysicalMaterial color="#777777" metalness={0.9} roughness={0.15} clearcoat={0.6} />
        </mesh>
        {/* Oarlock */}
        <mesh position={[-1.15, 0, 0]}>
          <torusGeometry args={[0.04, 0.015, 8, 16]} />
          <meshPhysicalMaterial color="#555555" metalness={0.9} roughness={0.2} clearcoat={0.5} />
        </mesh>
        {/* Oar shaft - Carbon fiber look */}
        <mesh position={[-1.8, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.02, 0.025, 2.8, 12]} />
          <meshPhysicalMaterial 
            color="#1a1a1a" 
            metalness={0.3} 
            roughness={0.4}
            clearcoat={0.8}
            clearcoatRoughness={0.2}
          />
        </mesh>
        {/* Oar blade - Composite material */}
        <mesh position={[-3.3, 0, 0]}>
          <boxGeometry args={[0.55, 0.015, 0.18]} />
          <meshPhysicalMaterial 
            color="#2563eb" 
            metalness={0.0} 
            roughness={0.3}
            clearcoat={0.5}
            clearcoatRoughness={0.15}
          />
        </mesh>
      </group>
      
      {/* Right oar group */}
      <group ref={rightOarRef} position={[0.3, 0.15, 0.5]}>
        {/* Rigger */}
        <mesh position={[0.6, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.025, 0.025, 1.2, 12]} />
          <meshPhysicalMaterial color="#777777" metalness={0.9} roughness={0.15} clearcoat={0.6} />
        </mesh>
        {/* Oarlock */}
        <mesh position={[1.15, 0, 0]}>
          <torusGeometry args={[0.04, 0.015, 8, 16]} />
          <meshPhysicalMaterial color="#555555" metalness={0.9} roughness={0.2} clearcoat={0.5} />
        </mesh>
        {/* Oar shaft - Carbon fiber look */}
        <mesh position={[1.8, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.02, 0.025, 2.8, 12]} />
          <meshPhysicalMaterial 
            color="#1a1a1a" 
            metalness={0.3} 
            roughness={0.4}
            clearcoat={0.8}
            clearcoatRoughness={0.2}
          />
        </mesh>
        {/* Oar blade - Composite material */}
        <mesh position={[3.3, 0, 0]}>
          <boxGeometry args={[0.55, 0.015, 0.18]} />
          <meshPhysicalMaterial 
            color="#2563eb" 
            metalness={0.0} 
            roughness={0.3}
            clearcoat={0.5}
            clearcoatRoughness={0.15}
          />
        </mesh>
      </group>
    </group>
  );
};

// ============================================================================
// MAIN SCENE - Handles boat movement along curved GPS path, camera following, and scenery
// ============================================================================
const RowerScene: React.FC<Rower3DProps> = ({ 
  route, 
  paceSPer500, 
  distanceMeters, 
  isPlaying, 
  cadence,
  intensityFactor 
}) => {
  const { camera } = useThree();
  
  // Detect route theme for landscape selection
  const routeTheme = useMemo(() => detectRouteTheme(route), [route]);
  const atmosphere = useMemo(() => getThemeAtmosphere(routeTheme), [routeTheme]);
  
  // Create curved path from GPS coordinates
  const routeCurve = useMemo(() => {
    return createRouteCurve(route.coordinates, 0.1);
  }, [route.coordinates]);
  
  // Pre-calculate curve distances for accurate progress mapping
  const curveData = useMemo(() => {
    if (!routeCurve) return { distances: [], length: 0 };
    const distances = getCurveDistances(routeCurve);
    const length = distances[distances.length - 1] || 0;
    return { distances, length };
  }, [routeCurve]);
  
  // Boat state - progress along curve (0-1) and rotation angle
  const boatProgressRef = useRef<number>(0);
  const boatRotationRef = useRef<number>(0);
  const boatPositionRef = useRef<THREE.Vector3>(new THREE.Vector3(0, 0, 0));
  const [boatProgress, setBoatProgress] = useState(0);
  const [boatZ, setBoatZ] = useState(0); // For scenery positioning (legacy compatibility)
  
  // Calculate total route distance in meters
  const totalDistance = useMemo(() => {
    return routeTotalDistanceMeters(route.coordinates);
  }, [route.coordinates]);
  
  // Animation loop - move boat along curved path and camera follows
  useFrame((_, delta) => {
    // Calculate speed from pace (seconds per 500m -> meters per second)
    let speedMps = 0;
    if (paceSPer500 && paceSPer500 > 0) {
      speedMps = 500 / paceSPer500;
    }
    
    // Apply intensity factor if provided
    if (intensityFactor && intensityFactor > 0) {
      speedMps *= intensityFactor;
    }
    
    // Calculate target progress
    let targetProgress = boatProgressRef.current;
    
    if (isPlaying && speedMps > 0 && totalDistance > 0 && curveData.length > 0) {
      // Convert speed to curve progress rate
      // Real speed (m/s) -> progress per second = speed / totalDistance
      const progressRate = (speedMps / totalDistance);
      targetProgress = Math.min(1, boatProgressRef.current + progressRate * delta);
      boatProgressRef.current = targetProgress;
    } else if (distanceMeters !== null && distanceMeters !== undefined && totalDistance > 0) {
      // When not playing, position based on distance traveled
      targetProgress = distanceToProgress(
        distanceMeters,
        totalDistance,
        curveData.distances,
        curveData.length
      );
      // Smooth transition to target
      boatProgressRef.current += (targetProgress - boatProgressRef.current) * delta * 3;
    }
    
    // Get boat position and rotation from curve
    const routePos = getRoutePositionAtProgress(routeCurve, boatProgressRef.current);
    boatPositionRef.current.copy(routePos.position);
    boatRotationRef.current = routePos.angle;
    
    // Update state for scenery positioning (throttled)
    if (Math.abs(boatProgressRef.current - boatProgress) > 0.001) {
      setBoatProgress(boatProgressRef.current);
    }
    
    // Update boatZ for legacy scenery components (throttled)
    const currentZ = boatPositionRef.current.z;
    if (Math.abs(currentZ - boatZ) > 5) {
      setBoatZ(currentZ);
    }
    
    // Camera follows boat from behind (relative to boat heading)
    // Camera offset: 6 units behind, 2.5 units above
    const cameraDistance = 6;
    const cameraHeight = 2.5;
    
    // Calculate camera position behind the boat using its rotation
    // The boat's tangent direction is where it's heading
    // Camera should be BEHIND the boat (opposite of tangent direction)
    const tangent = routePos.tangent;
    
    camera.position.set(
      boatPositionRef.current.x - tangent.x * cameraDistance,
      boatPositionRef.current.y + cameraHeight,
      boatPositionRef.current.z - tangent.z * cameraDistance
    );
    
    // Camera looks at the boat
    camera.lookAt(
      boatPositionRef.current.x,
      boatPositionRef.current.y + 0.3,
      boatPositionRef.current.z
    );
    
    // Expose boat position for Playwright testing
    try {
      if ((window as any).__PLAYWRIGHT_TESTING) {
        (window as any).__ROWER3D_POS = {
          x: boatPositionRef.current.x,
          y: boatPositionRef.current.y,
          z: boatPositionRef.current.z,
          progress: boatProgressRef.current,
          angle: boatRotationRef.current
        };
        (window as any).__ROWER3D_CAMERA = {
          position: [camera.position.x, camera.position.y, camera.position.z]
        };
        (window as any).__ROWER3D_ROUTE = {
          hasCurve: !!routeCurve,
          totalDistance,
          curveLength: curveData.length
        };
      }
    } catch {}
  });
  
  // Render themed landscape based on route
  const renderThemedLandscape = () => {
    switch (routeTheme) {
      case 'crystal-bled':
        return (
          <>
            <CrystalBledLandscape side="left" boatZ={boatZ} />
            <CrystalBledLandscape side="right" boatZ={boatZ} />
          </>
        );
      case 'gothic-venice':
        return (
          <>
            <GothicVeniceLandscape side="left" boatZ={boatZ} />
            <GothicVeniceLandscape side="right" boatZ={boatZ} />
          </>
        );
      case 'steampunk-henley':
        return (
          <>
            <SteampunkHenleyLandscape side="left" boatZ={boatZ} />
            <SteampunkHenleyLandscape side="right" boatZ={boatZ} />
          </>
        );
      case 'dystopian-thames':
        return (
          <>
            <DystopianThamesLandscape side="left" boatZ={boatZ} />
            <DystopianThamesLandscape side="right" boatZ={boatZ} />
          </>
        );
      case 'scifi-boston':
        return (
          <>
            <SciFiBostonLandscape side="left" boatZ={boatZ} />
            <SciFiBostonLandscape side="right" boatZ={boatZ} />
          </>
        );
      default:
        // Willowbrook - keep original mountains and trees
        return (
          <>
            <ProceduralTerrain side="left" boatZ={boatZ} />
            <ProceduralTerrain side="right" boatZ={boatZ} />
            <PineTrees side="left" boatZ={boatZ} />
            <PineTrees side="right" boatZ={boatZ} />
          </>
        );
    }
  };
  
  // Get sky configuration for sun-aligned lighting
  const skyConfig = useMemo(() => getSkyConfig(routeTheme), [routeTheme]);
  
  return (
    <>
      {/* Themed exponential fog for depth */}
      <fog attach="fog" args={[atmosphere.fogColor, atmosphere.fogNear, atmosphere.fogFar]} />
      
      {/* Photorealistic skydome with physically-based sky and clouds */}
      <PhotorealisticSkydome theme={routeTheme} boatZ={boatZ} />
      
      {/* Hemisphere light - sky and ground colors matched to theme */}
      <hemisphereLight 
        args={[
          routeTheme === 'dystopian-thames' ? '#4a3728' : 
          routeTheme === 'gothic-venice' ? '#3d4f5f' :
          routeTheme === 'steampunk-henley' ? '#d4a574' :
          routeTheme === 'scifi-boston' ? '#1e3a5f' :
          '#b4d7ff',  // Sky color
          routeTheme === 'dystopian-thames' ? '#1a1a1a' :
          routeTheme === 'gothic-venice' ? '#2c3e50' :
          '#3d5c3a',  // Ground color
          routeTheme === 'dystopian-thames' || routeTheme === 'gothic-venice' ? 0.5 : 0.9
        ]} 
        position={[0, 50, 0]}
      />
      
      {/* Primary sunlight - position and color matched to sky */}
      <directionalLight
        position={skyConfig.sunPosition}
        intensity={
          routeTheme === 'dystopian-thames' ? 0.4 :
          routeTheme === 'gothic-venice' ? 0.5 :
          routeTheme === 'scifi-boston' ? 0.3 :
          routeTheme === 'steampunk-henley' ? 1.5 :  // Golden hour
          1.2
        }
        color={
          routeTheme === 'dystopian-thames' ? '#ff6b35' :  // Red-orange pollution
          routeTheme === 'gothic-venice' ? '#8fa4b8' :     // Cold twilight
          routeTheme === 'steampunk-henley' ? '#ffd700' :  // Golden sunset
          routeTheme === 'scifi-boston' ? '#a0d2ff' :      // Moonlight blue
          '#fffaf0'  // Warm daylight
        }
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-far={500}
        shadow-camera-left={-100}
        shadow-camera-right={100}
        shadow-camera-top={100}
        shadow-camera-bottom={-100}
      />
      
      {/* Ambient light for fill - matched to atmosphere */}
      <ambientLight 
        intensity={
          routeTheme === 'dystopian-thames' ? 0.1 :
          routeTheme === 'gothic-venice' ? 0.12 :
          routeTheme === 'scifi-boston' ? 0.15 :
          0.25
        }
        color={
          routeTheme === 'dystopian-thames' ? '#2a1f1a' :
          routeTheme === 'gothic-venice' ? '#4a5568' :
          routeTheme === 'scifi-boston' ? '#162447' :
          '#e8f4f8'
        }
      />
      
      {/* Fill light from opposite side for soft shadows */}
      <directionalLight
        position={[-skyConfig.sunPosition[0] * 0.6, 50, -skyConfig.sunPosition[2] * 0.5]}
        intensity={
          routeTheme === 'dystopian-thames' || routeTheme === 'gothic-venice' ? 0.15 : 0.3
        }
        color={
          routeTheme === 'steampunk-henley' ? '#ffb347' :  // Warm bounce
          routeTheme === 'scifi-boston' ? '#4a90d9' :      // Cool sci-fi
          '#b4c7dc'  // Cool blue fill
        }
      />
      
      {/* HDR Environment for realistic reflections - matched to theme */}
      <Environment 
        preset={
          routeTheme === 'scifi-boston' ? 'night' :
          routeTheme === 'dystopian-thames' ? 'sunset' :
          routeTheme === 'gothic-venice' ? 'dawn' :
          routeTheme === 'steampunk-henley' ? 'sunset' :
          'city'
        } 
        background={false} 
        blur={0.5}
        environmentIntensity={skyConfig.exposure}
      />
      
      {/* Water - curved if we have GPS curve, otherwise straight */}
      {routeCurve ? (
        <CurvedWaterChannel curve={routeCurve} theme={routeTheme} boatProgress={boatProgress} />
      ) : (
        <PhotorealisticWater boatZ={boatZ} theme={routeTheme} />
      )}
      
      {/* Curved riverbanks following the GPS path */}
      {routeCurve && (
        <CurvedRiverbanks curve={routeCurve} theme={routeTheme} />
      )}
      
      {/* Mist layer for atmospheric depth */}
      <MistLayer boatZ={boatZ} theme={routeTheme} />
      
      {/* Themed riverbanks - use straight banks only when no curve */}
      {!routeCurve && (
        <ThemedRiverbanks boatZ={boatZ} theme={routeTheme} />
      )}
      
      {/* Themed landscape elements - along curve or straight */}
      {routeCurve ? (
        <CurvedLandscapeElements curve={routeCurve} theme={routeTheme} boatProgress={boatProgress} />
      ) : (
        renderThemedLandscape()
      )}
      
      {/* The rowing scull - positioned and rotated along curved path */}
      <RowingScull 
        position={[
          boatPositionRef.current.x, 
          boatPositionRef.current.y, 
          boatPositionRef.current.z
        ]}
        rotation={[0, boatRotationRef.current, 0]}
        cadence={cadence || 30}
      />
      
      {/* Post-processing effects for photorealism - disabled in test mode */}
      {!(window as any).__PLAYWRIGHT_TESTING && (
        <EffectComposer>
          {/* Subtle bloom for water highlights and reflections */}
          <Bloom
            intensity={0.15}
            luminanceThreshold={0.85}
            luminanceSmoothing={0.9}
          />
          
          {/* Filmic tone mapping for realistic color response */}
          <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
        </EffectComposer>
      )}
    </>
  );
};

// ============================================================================
// GPU ERROR BOUNDARY
// ============================================================================
class GPUErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('GPU Error Boundary caught error:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="rower3d-fallback-marker" data-loaded="true">
          3D rendering error - GPU may not be available
        </div>
      );
    }
    return this.props.children;
  }
}

// ============================================================================
// MAIN COMPONENT - Canvas wrapper with GPU detection
// ============================================================================
const Rower3D: React.FC<Rower3DProps> = (props) => {
  const isHighQuality = props.performanceMode !== 'low';
  const [gpuBackend, setGpuBackend] = useState<GPUBackend>('webgl');
  
  // Detect GPU availability on mount
  useEffect(() => {
    let mounted = true;
    
    async function detectBackend() {
      try {
        const webgpuAvailable = await isWebGPUAvailable();
        if (mounted) {
          if (webgpuAvailable) {
            setGpuBackend('webgpu');
          } else if (isWebGLAvailable()) {
            setGpuBackend('webgl');
          } else {
            setGpuBackend('none');
          }
        }
      } catch {
        if (mounted) {
          setGpuBackend(isWebGLAvailable() ? 'webgl' : 'none');
        }
      }
    }
    
    detectBackend();
    return () => { mounted = false; };
  }, []);
  
  // If no GPU, show fallback
  if (gpuBackend === 'none') {
    return (
      <div className="rower3d-canvas-container">
        <div className="rower3d-fallback-marker" data-loaded="true" style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          color: '#888'
        }}>
          3D view unavailable - GPU rendering not supported
        </div>
      </div>
    );
  }
  
  return (
    <div className="rower3d-canvas-container">
      <div className="rower3d-fallback-marker" data-loaded="true" style={{ display: 'none' }} />
      <div className="rower3d-gpu-backend" data-backend={gpuBackend} style={{ display: 'none' }} />
      <GPUErrorBoundary>
        <Canvas
          camera={{ position: [0, 2.5, 6], fov: 60 }}
          shadows={isHighQuality}
          gl={{
            antialias: isHighQuality,
            alpha: true,
            powerPreference: isHighQuality ? 'high-performance' : 'low-power',
            failIfMajorPerformanceCaveat: false,
            preserveDrawingBuffer: true,
            toneMapping: THREE.ACESFilmicToneMapping,
            toneMappingExposure: 1.0,
          }}
          onCreated={({ gl }) => {
            gl.outputColorSpace = THREE.SRGBColorSpace;
            try {
              (window as any).__ROWER3D_GPU_BACKEND = gpuBackend;
            } catch {}
            
            // Handle WebGL context lost/restored for Playwright tests
            const canvas = gl.domElement;
            canvas.addEventListener('webglcontextlost', (ev) => {
              try {
                ev.preventDefault?.();
                const marker = document.querySelector('.rower3d-fallback-marker') as HTMLElement | null;
                if (marker) marker.style.display = 'block';
                (window as any).__ROWER3D_WEBGL_LOST = true;
              } catch {}
            }, false);
            canvas.addEventListener('webglcontextrestored', () => {
              try {
                const marker = document.querySelector('.rower3d-fallback-marker') as HTMLElement | null;
                if (marker) marker.style.display = 'none';
                (window as any).__ROWER3D_WEBGL_LOST = false;
              } catch {}
            }, false);
          }}
        >
          <RowerScene {...props} />
        </Canvas>
      </GPUErrorBoundary>
    </div>
  );
};

export default Rower3D;
