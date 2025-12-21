import React, { useRef, useMemo, useEffect, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { WaterRoute } from '../types/index';
import { routeTotalDistanceMeters } from '../utils/geoUtils';
import { isWebGPUAvailable, isWebGLAvailable } from '../utils/gpuUtils';
import './Rower3D.css';

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
// ANIMATED WATER PLANE - Creates flowing water effect
// ============================================================================
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
// THEMED WATER - Water color varies by route theme
// ============================================================================
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
  cadence: number;
}> = ({ position, cadence }) => {
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
    <group position={position}>
      {/* Main hull - long narrow racing shell */}
      <mesh castShadow>
        <boxGeometry args={[0.45, 0.15, 8]} />
        <meshStandardMaterial color="#f5d742" metalness={0.4} roughness={0.3} />
      </mesh>
      
      {/* Hull deck detail */}
      <mesh position={[0, 0.08, 0]} castShadow>
        <boxGeometry args={[0.4, 0.02, 7.5]} />
        <meshStandardMaterial color="#ffeaa7" metalness={0.3} roughness={0.4} />
      </mesh>
      
      {/* Bow (front) - pointed cone toward -Z */}
      <mesh position={[0, 0, -4.2]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <coneGeometry args={[0.22, 1.0, 12]} />
        <meshStandardMaterial color="#f5d742" metalness={0.4} roughness={0.3} />
      </mesh>
      
      {/* Stern (back) - tapered toward +Z */}
      <mesh position={[0, 0, 4]} rotation={[-Math.PI / 2, 0, 0]} castShadow>
        <coneGeometry args={[0.2, 0.8, 12]} />
        <meshStandardMaterial color="#f5d742" metalness={0.4} roughness={0.3} />
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
          <meshStandardMaterial color="#888888" metalness={0.8} roughness={0.2} />
        </mesh>
        {/* Oarlock */}
        <mesh position={[-1.15, 0, 0]}>
          <torusGeometry args={[0.04, 0.015, 8, 16]} />
          <meshStandardMaterial color="#666666" metalness={0.7} roughness={0.3} />
        </mesh>
        {/* Oar shaft */}
        <mesh position={[-1.8, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.02, 0.025, 2.8, 12]} />
          <meshStandardMaterial color="#c4a882" roughness={0.6} />
        </mesh>
        {/* Oar blade - spoon shape */}
        <mesh position={[-3.3, 0, 0]}>
          <boxGeometry args={[0.55, 0.015, 0.18]} />
          <meshStandardMaterial color="#1e40af" metalness={0.2} roughness={0.5} />
        </mesh>
      </group>
      
      {/* Right oar group */}
      <group ref={rightOarRef} position={[0.3, 0.15, 0.5]}>
        {/* Rigger */}
        <mesh position={[0.6, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.025, 0.025, 1.2, 12]} />
          <meshStandardMaterial color="#888888" metalness={0.8} roughness={0.2} />
        </mesh>
        {/* Oarlock */}
        <mesh position={[1.15, 0, 0]}>
          <torusGeometry args={[0.04, 0.015, 8, 16]} />
          <meshStandardMaterial color="#666666" metalness={0.7} roughness={0.3} />
        </mesh>
        {/* Oar shaft */}
        <mesh position={[1.8, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.02, 0.025, 2.8, 12]} />
          <meshStandardMaterial color="#c4a882" roughness={0.6} />
        </mesh>
        {/* Oar blade */}
        <mesh position={[3.3, 0, 0]}>
          <boxGeometry args={[0.55, 0.015, 0.18]} />
          <meshStandardMaterial color="#1e40af" metalness={0.2} roughness={0.5} />
        </mesh>
      </group>
    </group>
  );
};

// ============================================================================
// MAIN SCENE - Handles boat movement, camera following, and scenery
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
  
  // Boat position ref - boat moves along -Z axis
  const boatPositionRef = useRef<THREE.Vector3>(new THREE.Vector3(0, 0, 0));
  const [boatZ, setBoatZ] = useState(0);
  
  // Calculate total route distance
  const totalDistance = useMemo(() => {
    return routeTotalDistanceMeters(route.coordinates);
  }, [route.coordinates]);
  
  // Animation loop - move boat forward and camera follows
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
    
    // Move boat forward along -Z axis when playing
    if (isPlaying && speedMps > 0) {
      // Convert real speed to scene units (1 unit ~= 2 meters, but we use 1:1 for simplicity)
      const sceneSpeed = speedMps * 0.5; // Scale down for visual comfort
      boatPositionRef.current.z -= sceneSpeed * delta;
    } else if (distanceMeters !== null && distanceMeters !== undefined && totalDistance > 0) {
      // When not playing, position based on distance traveled
      const progress = Math.min(1, distanceMeters / totalDistance);
      const targetZ = -progress * totalDistance * 0.1; // Scale route to scene
      boatPositionRef.current.z += (targetZ - boatPositionRef.current.z) * delta * 3;
    }
    
    // Update state for scenery positioning (throttled)
    const currentZ = boatPositionRef.current.z;
    if (Math.abs(currentZ - boatZ) > 5) {
      setBoatZ(currentZ);
    }
    
    // Camera follows boat with fixed offset (chase view)
    // Camera at (0, 2.5, 6) relative to boat = behind and above
    camera.position.set(
      boatPositionRef.current.x,
      boatPositionRef.current.y + 2.5,
      boatPositionRef.current.z + 6
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
          progress: totalDistance > 0 ? Math.abs(boatPositionRef.current.z * 10) / totalDistance : 0
        };
        (window as any).__ROWER3D_CAMERA = {
          position: [camera.position.x, camera.position.y, camera.position.z]
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
  
  return (
    <>
      {/* Themed fog and sky */}
      <fog attach="fog" args={[atmosphere.fogColor, atmosphere.fogNear, atmosphere.fogFar]} />
      <color attach="background" args={[atmosphere.skyColor]} />
      
      {/* Hemisphere light - sky and ground colors */}
      <hemisphereLight 
        args={['#ffffff', '#888888', 0.8]} 
        position={[0, 50, 0]}
      />
      
      {/* Directional light (sunlight) with shadows */}
      <directionalLight
        position={[50, 100, 50]}
        intensity={routeTheme === 'dystopian-thames' || routeTheme === 'gothic-venice' ? 0.6 : 1.2}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-far={500}
        shadow-camera-left={-100}
        shadow-camera-right={100}
        shadow-camera-top={100}
        shadow-camera-bottom={-100}
      />
      
      {/* Ambient light for fill - dimmer for dark themes */}
      <ambientLight intensity={routeTheme === 'dystopian-thames' || routeTheme === 'gothic-venice' ? 0.15 : 0.3} />
      
      {/* Themed water plane */}
      <ThemedWater boatZ={boatZ} theme={routeTheme} />
      
      {/* Themed riverbanks */}
      <ThemedRiverbanks boatZ={boatZ} theme={routeTheme} />
      
      {/* Themed landscape elements */}
      {renderThemedLandscape()}
      
      {/* The rowing scull - positioned at current boat location */}
      <RowingScull 
        position={[
          boatPositionRef.current.x, 
          boatPositionRef.current.y, 
          boatPositionRef.current.z
        ]} 
        cadence={cadence || 30}
      />
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
