import React, { useRef, useMemo, useEffect, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { WaterRoute } from '../types/index';
import { routeTotalDistanceMeters } from '../utils/geoUtils';
import { isWebGPUAvailable, isWebGLAvailable } from '../utils/gpuUtils';
import './Rower3D.css';

// GPU backend type for renderer selection
type GPUBackend = 'webgpu' | 'webgl' | 'none';

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
      }
    } catch {}
  });
  
  return (
    <>
      {/* Sky blue fog for atmosphere */}
      <fog attach="fog" args={['#a0cdfa', 50, 500]} />
      <color attach="background" args={['#a0cdfa']} />
      
      {/* Hemisphere light - sky and ground colors */}
      <hemisphereLight 
        args={['#ffffff', '#888888', 0.8]} 
        position={[0, 50, 0]}
      />
      
      {/* Directional light (sunlight) with shadows */}
      <directionalLight
        position={[50, 100, 50]}
        intensity={1.2}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-far={500}
        shadow-camera-left={-100}
        shadow-camera-right={100}
        shadow-camera-top={100}
        shadow-camera-bottom={-100}
      />
      
      {/* Ambient light for fill */}
      <ambientLight intensity={0.3} />
      
      {/* Animated water plane */}
      <AnimatedWater boatZ={boatZ} />
      
      {/* Riverbanks */}
      <Riverbanks boatZ={boatZ} />
      
      {/* Procedural mountains on both sides */}
      <ProceduralTerrain side="left" boatZ={boatZ} />
      <ProceduralTerrain side="right" boatZ={boatZ} />
      
      {/* Pine trees along the banks */}
      <PineTrees side="left" boatZ={boatZ} />
      <PineTrees side="right" boatZ={boatZ} />
      
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
          }}
        >
          <RowerScene {...props} />
        </Canvas>
      </GPUErrorBoundary>
    </div>
  );
};

export default Rower3D;
