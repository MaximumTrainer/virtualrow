import React, { useRef, useMemo, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import { RigidBody } from '@react-three/rapier';
import type { RapierRigidBody } from '@react-three/rapier';
import * as THREE from 'three';
import { IS_TEST_MODE } from './constants';
import { createBoatNormalMap } from './helpers';

// ============================================================================
// OAR RIG — HD rigger, oarlock, shaft, and blade for one side
// ============================================================================
const OarRig: React.FC<{ side: 'left' | 'right' }> = ({ side }) => {
  const sx = side === 'left' ? -1 : 1;
  return (
    <>
      <mesh position={[sx * 0.6, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.028, 0.028, 1.2, 16]} />
        <meshPhysicalMaterial color="#9a9a9a" metalness={0.95} roughness={0.08} clearcoat={0.75} clearcoatRoughness={0.12} reflectivity={0.9} />
      </mesh>
      <mesh position={[sx * 0.3, -0.08, 0]} rotation={[0, 0, sx * -0.4]}>
        <cylinderGeometry args={[0.012, 0.012, 0.35, 12]} />
        <meshPhysicalMaterial color="#8a8a8a" metalness={0.92} roughness={0.1} />
      </mesh>
      <mesh position={[sx * 1.15, 0, 0]}>
        <torusGeometry args={[0.045, 0.018, 12, 20]} />
        <meshPhysicalMaterial color="#b8b8b8" metalness={0.98} roughness={0.06} clearcoat={0.85} clearcoatRoughness={0.08} reflectivity={0.95} />
      </mesh>
      <mesh position={[sx * 1.8, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.022, 0.028, 2.8, 16]} />
        <meshPhysicalMaterial color="#c0a060" metalness={0.1} roughness={0.15} clearcoat={0.6} clearcoatRoughness={0.2} sheen={0.2} sheenColor="#d0b070" />
      </mesh>
      <mesh position={[sx * 0.35, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.032, 0.032, 0.3, 16]} />
        <meshPhysicalMaterial color="#1a1a1a" roughness={0.85} metalness={0.0} />
      </mesh>
      <mesh position={[sx * 3.3, 0, 0]}>
        <boxGeometry args={[0.58, 0.018, 0.2]} />
        <meshPhysicalMaterial color="#1a3c6b" metalness={0} roughness={0.4} clearcoat={0.5} clearcoatRoughness={0.2} sheen={0.2} sheenColor="#2a5080" />
      </mesh>
      <mesh position={[sx * 3.55, 0, 0]}>
        <boxGeometry args={[0.08, 0.016, 0.19]} />
        <meshPhysicalMaterial color="#0f2460" roughness={0.4} metalness={0} clearcoat={0.5} />
      </mesh>
    </>
  );
};

// ============================================================================
// ROWING SCULL BASE
// ============================================================================
const RowingScullBase: React.FC<{ cadence: number; strokeCycleTRef?: React.MutableRefObject<number> }> = ({ cadence, strokeCycleTRef }) => {
  const leftOarRef  = useRef<THREE.Group>(null);
  const rightOarRef = useRef<THREE.Group>(null);
  const torsoRef    = useRef<THREE.Group>(null);
  const headRef     = useRef<THREE.Mesh>(null);
  const leftUpperArmRef  = useRef<THREE.Group>(null);
  const rightUpperArmRef = useRef<THREE.Group>(null);
  const leftForearmRef   = useRef<THREE.Group>(null);
  const rightForearmRef  = useRef<THREE.Group>(null);
  const leftThighRef  = useRef<THREE.Group>(null);
  const rightThighRef = useRef<THREE.Group>(null);
  const leftShinRef   = useRef<THREE.Group>(null);
  const rightShinRef  = useRef<THREE.Group>(null);
  const seatRef = useRef<THREE.Mesh>(null);
  
  useFrame((state) => {
    const strokesPerMinute = Math.max(18, cadence || 24);
    const freqHz = strokesPerMinute / 60;
    const time = state.clock.elapsedTime;
    const phase = strokeCycleTRef ? strokeCycleTRef.current : (time * freqHz % 1);
    
    const easeInOut = (t: number) => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    
    let legCompression: number;
    let armPull: number;
    let bodyLean: number;
    let seatPosition: number;
    
    if (phase < 0.4) {
      const t = easeInOut(phase / 0.4);
      legCompression = 1 - t;
      armPull = t;
      bodyLean = -0.3 + t * 0.5;
      seatPosition = -0.5 + t * 0.5;
    } else {
      const t = easeInOut((phase - 0.4) / 0.6);
      legCompression = t;
      armPull = 1 - t;
      bodyLean = 0.2 - t * 0.5;
      seatPosition = t * -0.5;
    }
    
    const oarSweep = Math.sin(phase * Math.PI * 2) * 0.5;
    
    if (leftOarRef.current) leftOarRef.current.rotation.y = oarSweep;
    if (rightOarRef.current) rightOarRef.current.rotation.y = -oarSweep;
    
    try {
      if (IS_TEST_MODE) {
        window.__ROWER3D_OAR_ANGLE = oarSweep;
        window.__ROWER3D_STROKE_RATE = strokesPerMinute;
      }
    } catch { /* intentional: window access may fail in test environments */ }
    
    if (torsoRef.current) torsoRef.current.rotation.x = bodyLean;
    if (headRef.current) headRef.current.rotation.x = -bodyLean * 0.3;
    if (seatRef.current) seatRef.current.position.z = seatPosition;
    
    const thighAngle = -0.3 + legCompression * 1.0;
    const shinAngle  = 0.2 + legCompression * 1.2;
    
    if (leftThighRef.current)  leftThighRef.current.rotation.x  = thighAngle;
    if (rightThighRef.current) rightThighRef.current.rotation.x = thighAngle;
    if (leftShinRef.current)   leftShinRef.current.rotation.x   = shinAngle;
    if (rightShinRef.current)  rightShinRef.current.rotation.x  = shinAngle;
    
    const upperArmAngle = -0.5 + armPull * 1.2;
    const forearmAngle  = 0.3 + armPull * 0.8;
    
    if (leftUpperArmRef.current)  leftUpperArmRef.current.rotation.x  = upperArmAngle;
    if (rightUpperArmRef.current) rightUpperArmRef.current.rotation.x = upperArmAngle;
    if (leftForearmRef.current)   leftForearmRef.current.rotation.x   = forearmAngle;
    if (rightForearmRef.current)  rightForearmRef.current.rotation.x  = forearmAngle;
  });
  
  const skinColor     = "#e0b89d";
  const skinHighlight = "#f0c8ad";
  const hairColor     = "#3d2314";
  const shirtColor    = "#1e40af";
  const shirtAccent   = "#2563eb";
  const shortsColor   = "#1e3a5f";

  const hullNormalMap = useMemo(() => createBoatNormalMap(), []);
  useEffect(() => () => hullNormalMap.dispose(), [hullNormalMap]);
  
  return (
    <group>
      {/* Main hull */}
      <mesh castShadow>
        <boxGeometry args={[0.45, 0.15, 8]} />
        <meshPhysicalMaterial color="#e8e4d8" metalness={0.0} roughness={0.2} clearcoat={0.8} clearcoatRoughness={0.1} reflectivity={0.95} envMapIntensity={1.5} sheen={0.4} sheenColor="#fffef0" sheenRoughness={0.2} ior={1.45} normalMap={hullNormalMap} normalScale={new THREE.Vector2(0.3, 0.3)} />
      </mesh>
      <mesh position={[0, 0.08, 0]} castShadow>
        <boxGeometry args={[0.4, 0.02, 7.5]} />
        <meshPhysicalMaterial color="#f0ecdE" metalness={0.0} roughness={0.22} clearcoat={0.8} clearcoatRoughness={0.1} sheen={0.25} sheenColor="#ffffff" />
      </mesh>
      <mesh position={[0, 0, -4.2]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <coneGeometry args={[0.22, 1.0, 16]} />
        <meshPhysicalMaterial color="#e8e4d8" metalness={0.0} roughness={0.2} clearcoat={0.8} clearcoatRoughness={0.1} reflectivity={0.95} sheen={0.4} sheenColor="#fffef0" />
      </mesh>
      <mesh position={[0, 0, 4]} rotation={[-Math.PI / 2, 0, 0]} castShadow>
        <coneGeometry args={[0.2, 0.8, 16]} />
        <meshPhysicalMaterial color="#e8e4d8" metalness={0.0} roughness={0.2} clearcoat={0.8} clearcoatRoughness={0.1} reflectivity={0.95} />
      </mesh>
      <mesh position={[0, 0.076, 0]}>
        <boxGeometry args={[0.42, 0.005, 7.2]} />
        <meshPhysicalMaterial color="#1e40af" metalness={0.0} roughness={0.15} clearcoat={1.0} clearcoatRoughness={0.02} />
      </mesh>
      <mesh position={[0, 0.12, 0]}>
        <boxGeometry args={[0.25, 0.02, 1.2]} />
        <meshPhysicalMaterial color="#8a8a8a" metalness={0.92} roughness={0.12} clearcoat={0.6} clearcoatRoughness={0.15} />
      </mesh>
      <mesh position={[-0.1, 0.125, 0]}>
        <boxGeometry args={[0.015, 0.015, 1.25]} />
        <meshPhysicalMaterial color="#606060" metalness={0.95} roughness={0.08} />
      </mesh>
      <mesh position={[0.1, 0.125, 0]}>
        <boxGeometry args={[0.015, 0.015, 1.25]} />
        <meshPhysicalMaterial color="#606060" metalness={0.95} roughness={0.08} />
      </mesh>
      <mesh ref={seatRef} position={[0, 0.18, 0]} castShadow>
        <boxGeometry args={[0.24, 0.045, 0.22]} />
        <meshPhysicalMaterial color="#1a1a1a" metalness={0.2} roughness={0.55} clearcoat={0.3} clearcoatRoughness={0.4} />
      </mesh>
      {[[-0.08, 0.14, -0.08], [0.08, 0.14, -0.08], [-0.08, 0.14, 0.08], [0.08, 0.14, 0.08]].map((pos, i) => (
        <mesh key={`wheel-${i}`} position={pos as [number, number, number]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.015, 0.015, 0.02, 12]} />
          <meshPhysicalMaterial color="#303030" metalness={0.8} roughness={0.2} />
        </mesh>
      ))}
      <mesh position={[0, 0.15, -0.6]} rotation={[0.4, 0, 0]}>
        <boxGeometry args={[0.35, 0.03, 0.25]} />
        <meshPhysicalMaterial color="#1a1a1a" metalness={0.15} roughness={0.45} clearcoat={0.7} clearcoatRoughness={0.25} />
      </mesh>
      <mesh position={[-0.1, 0.17, -0.55]} rotation={[0.4, 0, 0]}>
        <boxGeometry args={[0.08, 0.02, 0.18]} />
        <meshPhysicalMaterial color="#2a2a2a" roughness={0.85} />
      </mesh>
      <mesh position={[0.1, 0.17, -0.55]} rotation={[0.4, 0, 0]}>
        <boxGeometry args={[0.08, 0.02, 0.18]} />
        <meshPhysicalMaterial color="#2a2a2a" roughness={0.85} />
      </mesh>

      {/* Rower body */}
      <group position={[0, 0.35, 0]}>
        <group ref={torsoRef} position={[0, 0.15, 0]}>
          <mesh position={[0, 0, 0]} castShadow>
            <boxGeometry args={[0.28, 0.15, 0.18]} />
            <meshPhysicalMaterial color={shortsColor} roughness={0.72} metalness={0.0} sheen={0.35} sheenColor="#3a5a8a" sheenRoughness={0.6} />
          </mesh>
          <mesh position={[0, 0.12, 0]} castShadow>
            <boxGeometry args={[0.26, 0.12, 0.16]} />
            <meshPhysicalMaterial color={shirtColor} roughness={0.68} metalness={0.0} sheen={0.45} sheenColor={shirtAccent} sheenRoughness={0.55} />
          </mesh>
          <mesh position={[0, 0.26, 0]} castShadow>
            <boxGeometry args={[0.32, 0.16, 0.18]} />
            <meshPhysicalMaterial color={shirtColor} roughness={0.65} metalness={0.0} sheen={0.5} sheenColor={shirtAccent} sheenRoughness={0.5} />
          </mesh>
          <mesh position={[0, 0.36, 0]} castShadow>
            <boxGeometry args={[0.4, 0.08, 0.14]} />
            <meshPhysicalMaterial color={shirtColor} roughness={0.68} sheen={0.45} sheenColor={shirtAccent} />
          </mesh>
          <mesh position={[0, 0.44, 0]} castShadow>
            <cylinderGeometry args={[0.05, 0.06, 0.08, 16]} />
            <meshPhysicalMaterial color={skinColor} roughness={0.58} metalness={0.0} sheen={0.25} sheenColor={skinHighlight} sheenRoughness={0.7} clearcoat={0.08} clearcoatRoughness={0.85} />
          </mesh>
          <group position={[0, 0.56, 0]}>
            <mesh ref={headRef} castShadow>
              <sphereGeometry args={[0.1, 16, 12]} />
              <meshPhysicalMaterial color={skinColor} roughness={0.55} metalness={0.0} sheen={0.3} sheenColor={skinHighlight} sheenRoughness={0.65} clearcoat={0.1} clearcoatRoughness={0.8} />
            </mesh>
            <mesh position={[0, 0.04, -0.02]} castShadow>
              <sphereGeometry args={[0.095, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.6]} />
              <meshPhysicalMaterial color={hairColor} roughness={0.88} metalness={0.0} sheen={0.15} sheenColor="#5a3a24" sheenRoughness={0.9} />
            </mesh>
            <mesh position={[0, -0.01, 0.09]}>
              <boxGeometry args={[0.02, 0.03, 0.02]} />
              <meshPhysicalMaterial color={skinColor} roughness={0.55} sheen={0.2} sheenColor={skinHighlight} />
            </mesh>
            <mesh position={[-0.03, 0.02, 0.085]}>
              <sphereGeometry args={[0.012, 8, 8]} />
              <meshPhysicalMaterial color="#1a1008" roughness={0.12} metalness={0.0} clearcoat={1.0} clearcoatRoughness={0.02} reflectivity={0.95} />
            </mesh>
            <mesh position={[0.03, 0.02, 0.085]}>
              <sphereGeometry args={[0.012, 8, 8]} />
              <meshPhysicalMaterial color="#1a1008" roughness={0.12} metalness={0.0} clearcoat={1.0} clearcoatRoughness={0.02} reflectivity={0.95} />
            </mesh>
            <mesh position={[-0.1, 0, 0]}>
              <sphereGeometry args={[0.025, 8, 8]} />
              <meshPhysicalMaterial color={skinColor} roughness={0.58} sheen={0.2} sheenColor={skinHighlight} />
            </mesh>
            <mesh position={[0.1, 0, 0]}>
              <sphereGeometry args={[0.025, 8, 8]} />
              <meshPhysicalMaterial color={skinColor} roughness={0.58} sheen={0.2} sheenColor={skinHighlight} />
            </mesh>
          </group>
          <group ref={leftUpperArmRef} position={[-0.22, 0.32, 0]}>
            <mesh position={[0, -0.1, 0]} castShadow>
              <capsuleGeometry args={[0.038, 0.15, 12, 16]} />
              <meshPhysicalMaterial color={skinColor} roughness={0.56} sheen={0.28} sheenColor={skinHighlight} sheenRoughness={0.68} clearcoat={0.08} clearcoatRoughness={0.85} />
            </mesh>
            <group ref={leftForearmRef} position={[0, -0.2, 0]}>
              <mesh position={[0, -0.1, 0]} castShadow>
                <capsuleGeometry args={[0.032, 0.14, 12, 16]} />
                <meshPhysicalMaterial color={skinColor} roughness={0.55} sheen={0.26} sheenColor={skinHighlight} sheenRoughness={0.7} clearcoat={0.07} clearcoatRoughness={0.85} />
              </mesh>
              <mesh position={[0, -0.22, 0]} castShadow>
                <sphereGeometry args={[0.038, 8, 8]} />
                <meshPhysicalMaterial color={skinColor} roughness={0.58} sheen={0.22} sheenColor={skinHighlight} />
              </mesh>
            </group>
          </group>
          <group ref={rightUpperArmRef} position={[0.22, 0.32, 0]}>
            <mesh position={[0, -0.1, 0]} castShadow>
              <capsuleGeometry args={[0.038, 0.15, 12, 16]} />
              <meshPhysicalMaterial color={skinColor} roughness={0.56} sheen={0.28} sheenColor={skinHighlight} sheenRoughness={0.68} clearcoat={0.08} clearcoatRoughness={0.85} />
            </mesh>
            <group ref={rightForearmRef} position={[0, -0.2, 0]}>
              <mesh position={[0, -0.1, 0]} castShadow>
                <capsuleGeometry args={[0.032, 0.14, 12, 16]} />
                <meshPhysicalMaterial color={skinColor} roughness={0.55} sheen={0.26} sheenColor={skinHighlight} sheenRoughness={0.7} clearcoat={0.07} clearcoatRoughness={0.85} />
              </mesh>
              <mesh position={[0, -0.22, 0]} castShadow>
                <sphereGeometry args={[0.038, 8, 8]} />
                <meshPhysicalMaterial color={skinColor} roughness={0.58} sheen={0.22} sheenColor={skinHighlight} />
              </mesh>
            </group>
          </group>
        </group>
        
        {/* Left leg */}
        <group ref={leftThighRef} position={[-0.08, 0.1, 0]}>
          <mesh position={[0, 0, 0.12]} rotation={[Math.PI/2, 0, 0]} castShadow>
            <capsuleGeometry args={[0.052, 0.22, 12, 16]} />
            <meshPhysicalMaterial color={shortsColor} roughness={0.7} sheen={0.35} sheenColor="#3a5a8a" sheenRoughness={0.6} />
          </mesh>
          <group ref={leftShinRef} position={[0, 0, 0.28]}>
            <mesh position={[0, 0, 0.12]} rotation={[Math.PI/2, 0, 0]} castShadow>
              <capsuleGeometry args={[0.042, 0.2, 12, 16]} />
              <meshPhysicalMaterial color={skinColor} roughness={0.56} sheen={0.25} sheenColor={skinHighlight} sheenRoughness={0.7} clearcoat={0.06} clearcoatRoughness={0.85} />
            </mesh>
            <mesh position={[0, -0.02, 0.3]} castShadow>
              <boxGeometry args={[0.065, 0.035, 0.13]} />
              <meshPhysicalMaterial color="#1a1a1a" roughness={0.65} metalness={0.05} clearcoat={0.25} clearcoatRoughness={0.5} />
            </mesh>
            <mesh position={[0, -0.015, 0.32]}>
              <boxGeometry args={[0.06, 0.02, 0.06]} />
              <meshPhysicalMaterial color={shirtAccent} roughness={0.5} />
            </mesh>
          </group>
        </group>
        
        {/* Right leg */}
        <group ref={rightThighRef} position={[0.08, 0.1, 0]}>
          <mesh position={[0, 0, 0.12]} rotation={[Math.PI/2, 0, 0]} castShadow>
            <capsuleGeometry args={[0.052, 0.22, 12, 16]} />
            <meshPhysicalMaterial color={shortsColor} roughness={0.7} sheen={0.35} sheenColor="#3a5a8a" sheenRoughness={0.6} />
          </mesh>
          <group ref={rightShinRef} position={[0, 0, 0.28]}>
            <mesh position={[0, 0, 0.12]} rotation={[Math.PI/2, 0, 0]} castShadow>
              <capsuleGeometry args={[0.042, 0.2, 12, 16]} />
              <meshPhysicalMaterial color={skinColor} roughness={0.56} sheen={0.25} sheenColor={skinHighlight} sheenRoughness={0.7} clearcoat={0.06} clearcoatRoughness={0.85} />
            </mesh>
            <mesh position={[0, -0.02, 0.3]} castShadow>
              <boxGeometry args={[0.065, 0.035, 0.13]} />
              <meshPhysicalMaterial color="#1a1a1a" roughness={0.65} metalness={0.05} clearcoat={0.25} clearcoatRoughness={0.5} />
            </mesh>
            <mesh position={[0, -0.015, 0.32]}>
              <boxGeometry args={[0.06, 0.02, 0.06]} />
              <meshPhysicalMaterial color={shirtAccent} roughness={0.5} />
            </mesh>
          </group>
        </group>
      </group>
      
      <group ref={leftOarRef} position={[-0.3, 0.15, 0.5]}>
        <OarRig side="left" />
      </group>
      <group ref={rightOarRef} position={[0.3, 0.15, 0.5]}>
        <OarRig side="right" />
      </group>
    </group>
  );
};

// Memoized — only re-renders when cadence changes; position/rotation driven imperatively.
export const RowingScull = React.memo(RowingScullBase, (prev, next) => prev.cadence === next.cadence);

// ============================================================================
// BOAT KINEMATIC CONTROLLER
// ============================================================================
export const BoatKinematicController: React.FC<{
  positionRef: React.MutableRefObject<THREE.Vector3>;
  rotationRef: React.MutableRefObject<number>;
  cadence: number;
  strokeCycleTRef: React.MutableRefObject<number>;
}> = ({ positionRef, rotationRef, cadence, strokeCycleTRef }) => {
  const bodyRef = useRef<RapierRigidBody>(null);

  useFrame(() => {
    if (!bodyRef.current) return;
    bodyRef.current.setNextKinematicTranslation({
      x: positionRef.current.x,
      y: positionRef.current.y,
      z: positionRef.current.z,
    });
    const halfAngle = rotationRef.current / 2;
    bodyRef.current.setNextKinematicRotation({
      x: 0,
      y: Math.sin(halfAngle),
      z: 0,
      w: Math.cos(halfAngle),
    });
  });

  return (
    <RigidBody ref={bodyRef} type="kinematicPosition" colliders={false}>
      <RowingScull cadence={cadence} strokeCycleTRef={strokeCycleTRef} />
    </RigidBody>
  );
};
