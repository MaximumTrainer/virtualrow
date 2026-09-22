import React, { useRef, useMemo, useEffect, Suspense } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { BOAT_GROUP_NAME, IS_TEST_MODE } from './constants';
import { OAR_LEVER_RATIO, strokePose } from './strokePose';
import { WATER_SURFACE_Y } from './waterGeometry';
import { GLB_ROWER_NODES } from './crewRig';
import { createBoatNormalMap } from './helpers';
import { CREW_URL, type Crew } from './crewModel';

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
    
    // The same stroke the GLB scull uses, so the two cannot drift apart (#273).
    const pose = strokePose(phase);
    const { bodyLean, seatPosition, oarSweep } = pose;
    
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
    
    const { thighAngle, shinAngle } = pose;
    
    if (leftThighRef.current)  leftThighRef.current.rotation.x  = thighAngle;
    if (rightThighRef.current) rightThighRef.current.rotation.x = thighAngle;
    if (leftShinRef.current)   leftShinRef.current.rotation.x   = shinAngle;
    if (rightShinRef.current)  rightShinRef.current.rotation.x  = shinAngle;
    
    const { upperArmAngle, forearmAngle } = pose;
    
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
// GLB SCULL — production single scull + rower (public/assets/boat/, issue #229)
//
// Drop-in replacement for RowingScull with the same props.  Loads the crewed
// GLB (authored to the rig contract: Hull, Seat, Left/RightOar, Rower...) and
// drives the oar sweep from the same stroke phase the procedural boat used.
// ============================================================================
const GltfScullBase: React.FC<{
  cadence: number;
  strokeCycleTRef?: React.MutableRefObject<number>;
  crew?: Crew;
}> = ({ cadence, strokeCycleTRef, crew = 'male' }) => {
  const { scene } = useGLTF(CREW_URL[crew]);
  // Clone so the boat is independent of the cached source scene (static meshes,
  // so a plain deep clone preserves the named nodes we animate).
  const model = useMemo(() => scene.clone(true), [scene]);
  const oarsRef = useRef<{ left: THREE.Object3D | null; right: THREE.Object3D | null }>({ left: null, right: null });
  /** Where the rig authored the oars, so the dip is measured from it not from zero. */
  const oarRestYRef = useRef(0);
  useEffect(() => {
    const left = model.getObjectByName('LeftOar') ?? null;
    oarsRef.current = {
      left,
      right: model.getObjectByName('RightOar') ?? null,
    };
    if (left) oarRestYRef.current = left.position.y;
  }, [model]);

  // The rig authors these alongside the oars (scripts/build_crew.py), and they
  // were never animated: the blades swept while the rower held still, so the
  // boat looked as though it were rowing itself (#273).
  const rowerRef = useRef<Record<string, THREE.Object3D | null>>({});
  /** Where the rig authored the seat, so the slide is measured from it. */
  const seatRestZRef = useRef(0);

  useEffect(() => {
    rowerRef.current = Object.fromEntries(
      GLB_ROWER_NODES.map((name) => [name, model.getObjectByName(name) ?? null]),
    );
    const seat = rowerRef.current.Seat;
    if (seat) seatRestZRef.current = seat.position.z;
  }, [model]);

  useFrame((state) => {
    const strokesPerMinute = Math.max(18, cadence || 24);
    const freqHz = strokesPerMinute / 60;
    const phase = strokeCycleTRef ? strokeCycleTRef.current : (state.clock.elapsedTime * freqHz % 1);
    const pose = strokePose(phase);
    const { oarSweep } = pose;
    // The GLB is authored in the scene frame (up +Y), so local Y is world up and
    // rotation.y sweeps the oar horizontally about its gate — as the rig intends.
    const oars = oarsRef.current;
    if (oars.left) oars.left.rotation.y = oarSweep;
    if (oars.right) oars.right.rotation.y = -oarSweep;

    // The blades square up and go in, and feather and come out (#329). The oar
    // pivots at the gate, so the shaft's own roll is the feather, and lifting
    // the gate end by the lever ratio puts the tip at the height asked for.
    for (const oar of [oars.left, oars.right]) {
      if (!oar) continue;
      oar.rotation.z = pose.bladeFeatherRad;
      oar.position.y = oarRestYRef.current + pose.bladeHeightM * OAR_LEVER_RATIO;
    }

    // Arms draw in through the drive and extend on the recovery, from the same
    // pose that swept the oars — so they stay in step by construction.
    const rower = rowerRef.current;
    if (rower.Rower_LeftArm) rower.Rower_LeftArm.rotation.x = pose.upperArmAngle;
    if (rower.Rower_RightArm) rower.Rower_RightArm.rotation.x = pose.upperArmAngle;
    // The elbow, so the arm bends rather than swinging rigid from the shoulder.
    if (rower.LeftArm_Fore) rower.LeftArm_Fore.rotation.x = pose.forearmAngle;
    if (rower.RightArm_Fore) rower.RightArm_Fore.rotation.x = pose.forearmAngle;
    if (rower.Rower_Torso) rower.Rower_Torso.rotation.x = pose.bodyLean;
    // The slide, which nothing drove before #330: the legs compressed and the
    // seat stayed put, so the rower shrank and grew rather than sliding.
    if (rower.Seat) rower.Seat.position.z = seatRestZRef.current + pose.seatPosition;
    try {
      // Published under automation rather than only in test mode. The GLB scull
      // renders only when IS_TEST_MODE is false, so gating its telemetry on that
      // flag made the path real users see the one path automation could not
      // observe — which is how the rower came to sit rigid unnoticed (#273).
      if (IS_TEST_MODE || (typeof navigator !== 'undefined' && navigator.webdriver)) {
        window.__ROWER3D_OAR_ANGLE = oarSweep;
        window.__ROWER3D_STROKE_RATE = strokesPerMinute;
        window.__ROWER3D_ARM_ANGLE = pose.upperArmAngle;
        // Where the blade tip is relative to the water, so a spec can watch it
        // go in and come out rather than taking the pose's word for it (#329).
        window.__ROWER3D_BLADE_Y = WATER_SURFACE_Y + pose.bladeHeightM;
        // Where the seat is on the slide, so a spec can watch it move (#330).
        window.__ROWER3D_SEAT_Z = pose.seatPosition;
      }
    } catch { /* intentional: window access may fail in test environments */ }
  });

  return <primitive object={model} />;
};

export const GltfScull = React.memo(GltfScullBase, (prev, next) => prev.cadence === next.cadence && prev.crew === next.crew);

// ============================================================================
// BOAT KINEMATIC CONTROLLER
// ============================================================================
export const BoatKinematicController: React.FC<{
  positionRef: React.MutableRefObject<THREE.Vector3>;
  rotationRef: React.MutableRefObject<number>;
  cadence: number;
  strokeCycleTRef: React.MutableRefObject<number>;
  crew?: Crew;
}> = ({ positionRef, rotationRef, cadence, strokeCycleTRef, crew = 'male' }) => {
  const groupRef = useRef<THREE.Group>(null);

  // Straight onto the group.
  //
  // This used to set a kinematic translation and a quaternion on a Rapier
  // rigid body, which had no colliders and which nothing ever collided with,
  // so a physics engine read those two values back and wrote them onto exactly
  // this group (#322). The quaternion is gone with it: a heading about Y is a
  // Y rotation.
  useFrame(() => {
    const group = groupRef.current;
    if (!group) return;
    group.position.copy(positionRef.current);
    group.rotation.y = rotationRef.current;
  });

  return (
    <group ref={groupRef} name={BOAT_GROUP_NAME}>
      {IS_TEST_MODE ? (
        // Tests rely on the procedural boat's synchronous, asset-free oar signal.
        <RowingScull cadence={cadence} strokeCycleTRef={strokeCycleTRef} />
      ) : (
        // Production HD scull; the procedural boat is the fallback while the GLB
        // loads (and if it fails to load).
        <Suspense fallback={<RowingScull cadence={cadence} strokeCycleTRef={strokeCycleTRef} />}>
          <GltfScull cadence={cadence} strokeCycleTRef={strokeCycleTRef} crew={crew} />
        </Suspense>
      )}
    </group>
  );
};
