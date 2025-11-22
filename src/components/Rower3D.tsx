import React, { useRef, useMemo, useEffect, Suspense } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { CatmullRomCurve3, Vector3, Mesh } from 'three';
import { Line, useGLTF } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import { latLngToMeters, routeTotalDistanceMeters } from '../utils/geoUtils';
import type { WaterRoute } from '../types/index';
import './Rower3D.css';

interface Rower3DProps {
  route: WaterRoute;
  paceSPer500?: number | null; // seconds per 500m
  distanceMeters?: number | null; // meters
  isPlaying?: boolean;
  cadence?: number | null; // strokes per minute
  performanceMode?: 'auto' | 'high' | 'low';
}

// Simple boat mesh is built in the scene below

const RowerScene: React.FC<Rower3DProps> = ({ route, paceSPer500, distanceMeters, isPlaying, cadence, performanceMode }) => {
  // Convert latlng points into meters local coordinates
  const pointsLocal = useMemo(() => {
    if (!route || !route.coordinates || route.coordinates.length === 0) return [];
    const originLat = route.coordinates[0].lat;
    const originLng = route.coordinates[0].lng;
    return route.coordinates.map((c) => {
      const p = latLngToMeters(c.lat, c.lng, originLat, originLng);
      // We'll use z as 0 and map x ~ east, y ~ height (use small scale)
      return new Vector3(p.x * 0.001, 0, -p.y * 0.001);
    });
  }, [route]);

  const curve = useMemo(() => {
    if (pointsLocal.length === 0) return null;
    return new CatmullRomCurve3(pointsLocal);
  }, [pointsLocal]);

  const totalDistance = useMemo(() => routeTotalDistanceMeters(route.coordinates), [route]);

  // default boat progress is derived from distanceMeters / totalDistance
  const targetProgress = useMemo(() => {
    if (!distanceMeters || totalDistance === 0) return 0;
    const p = Math.min(1, Math.max(0, distanceMeters / totalDistance));
    return p;
  }, [distanceMeters, totalDistance]);

          
  const boatRef = useRef<Mesh | null>(null);
  const leftOarRef = useRef<Mesh | null>(null);
  const rightOarRef = useRef<Mesh | null>(null);
  const progressRef = useRef<number>(0);
  const posRef = useRef<Vector3>(new Vector3(0, 0, 0));
  const yawRef = useRef<number>(0);

  const { camera, gl } = useThree();
  // dynamic pixel ratio and simple performance adaptation
  // lastLongFrameRef retained for future use (was used for dynamic pixel ratio tuning)
  // Noop for now to not keep unused variable warnings
  const lastLongFrameRef = useRef<number>(0);
  const devicePixelRatio = typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1;
  React.useEffect(() => {
    const desired = (performanceMode === 'low') || (typeof window !== 'undefined' && (window as any).__PLAYWRIGHT_TESTING) ? 0.5 : devicePixelRatio;
    try {
      gl.setPixelRatio(desired);
    } catch (e) {}
  }, [gl, performanceMode, devicePixelRatio]);

  // Add WebGL context lost / restore handlers to enable graceful fallback
  useEffect(() => {
    if (!gl || !gl.domElement) return;
    const canvas = gl.domElement;
    const onContextLost = (ev: Event) => {
      try {
        // prevent default so we can control restoration
        // @ts-ignore
        ev.preventDefault && (ev as any).preventDefault();
      } catch (e) {}
      try {
        const marker = document.querySelector('.rower3d-fallback-marker') as HTMLElement | null;
        if (marker) marker.style.display = 'block';
        // Expose window flag for tests
        // @ts-ignore
        (window as any).__ROWER3D_WEBGL_LOST = true;
      } catch (e) {}
    };
    const onContextRestore = () => {
      try {
        const marker = document.querySelector('.rower3d-fallback-marker') as HTMLElement | null;
        if (marker) marker.style.display = 'none';
        // @ts-ignore
        (window as any).__ROWER3D_WEBGL_LOST = false;
      } catch (e) {}
    };
    canvas.addEventListener('webglcontextlost', onContextLost as any, false);
    canvas.addEventListener('webglcontextrestored', onContextRestore as any, false);
    return () => {
      canvas.removeEventListener('webglcontextlost', onContextLost as any);
      canvas.removeEventListener('webglcontextrestored', onContextRestore as any);
    };
  }, [gl]);

  // GLTF boat loader: optional. We'll try to load `public/models/boat.glb` in high perf.
  // Render GLTF model component separately to avoid conditional hook usage
  const GLTFBoat: React.FC = () => {
    let model: any | null = null;
    try {
      model = useGLTF('/models/boat.glb');
    } catch (e) {
      model = null;
    }
    return model && model.scene ? <primitive object={model.scene} /> : null;
  };
  useFrame((_, delta: number) => {
    if (!curve || !boatRef.current) return;
    // compute effective speed using pace if given; pace is seconds/500m -> m/s = 500/pace
    let speedMps = 0;
    if (paceSPer500 && paceSPer500 > 0) speedMps = 500 / paceSPer500; // m/s

    // convert to progress per second relative to route length
    const progressPerSecond = totalDistance > 0 ? (speedMps / totalDistance) : 0;

    if (isPlaying && speedMps > 0) {
      progressRef.current = Math.min(1, progressRef.current + progressPerSecond * delta);
    } else {
      // if not playing, smoothly follow targetProgress using damping
      progressRef.current += (targetProgress - progressRef.current) * Math.min(1, delta * 5);
    }

    // Get position and tangent from curve
    const pos = curve.getPointAt(progressRef.current);
    const tangent = curve.getTangentAt(progressRef.current).normalize();
    
    // Compute orientation from tangent (boat yaw)
    const yaw = Math.atan2(tangent.z, tangent.x);
    
    // Store in refs for use in render
    posRef.current.copy(pos);
    yawRef.current = yaw;
    
    // Keep boat stationary at a fixed position (upper portion of screen)
    // The boat stays at origin, rotated to face forward
    boatRef.current.position.set(0, 0, 1.5); // Position boat forward/up in view
    boatRef.current.rotation.set(0, -yaw + Math.PI, 0); // Face forward along route

    // Fixed camera position - behind and above the boat, looking forward
    // This creates the illusion that the boat is moving forward while the world moves back
    camera.position.set(0, 3.5, 4.5); // Behind and elevated
    camera.lookAt(0, 0, 0); // Look toward boat position

    // Oar animation: simulate realistic rowing stroke cycle
    // Rowing stroke phases: Catch -> Drive -> Finish -> Recovery
    // Use cadence if available and > 0, otherwise calculate from pace, or default to 30
    const strokesPerMinute = (cadence && cadence > 0) 
      ? cadence 
      : (paceSPer500 ? Math.min(60, Math.round(500 / (paceSPer500 || 100) * 0.25)) : 30);
    const freqHz = strokesPerMinute / 60;
    const cycleTime = performance.now() * 0.001 * freqHz; // cycles per second
    const phase = (cycleTime % 1) * Math.PI * 2; // 0 to 2π for one complete stroke
    
    // Rowing stroke motion mapping:
    // - Catch (0°): Oars forward in water, blade vertical
    // - Drive (0° to 90°): Pull through water, blade stays vertical
    // - Finish (90°): Oars back, blade exits water
    // - Recovery (90° to 360°): Oars return forward through air, blade feathered (horizontal)
    
    // Blade angle (rotation around shaft) - vertical in water, horizontal in air
    const bladeFeather = phase < Math.PI ? 0 : Math.PI / 2; // Flat during recovery
    
    // Oar sweep angle (forward/back motion)
    // Forward position (catch): ~60° forward from perpendicular
    // Back position (finish): ~30° back from perpendicular
    // Use smooth sinusoidal motion weighted toward the drive
    let oarSweep;
    if (phase < Math.PI * 0.4) {
      // Drive phase (faster, more power) - 40% of cycle
      oarSweep = Math.cos(phase / 0.4 * Math.PI / 2) * 1.0 - 0.5; // 0.5 to -0.5 radians
    } else {
      // Recovery phase (slower return) - 60% of cycle
      const recoveryPhase = (phase - Math.PI * 0.4) / (Math.PI * 1.6);
      oarSweep = -0.5 + recoveryPhase * 1.0; // -0.5 back to 0.5
    }
    
    // Left oar rotates opposite to right (sculling)
    if (leftOarRef.current) {
      leftOarRef.current.rotation.set(bladeFeather, 0, oarSweep);
    }
    if (rightOarRef.current) {
      rightOarRef.current.rotation.set(-bladeFeather, 0, -oarSweep);
    }

    // Expose oar angle for e2e testing
    try { // safe window access check
      // @ts-ignore
      if ((window as any).__PLAYWRIGHT_TESTING) {
        // @ts-ignore
        (window as any).__ROWER3D_OAR_ANGLE = oarSweep;
        // @ts-ignore
        (window as any).__ROWER3D_STROKE_RATE = strokesPerMinute;
      }
    } catch (e) {}

    // Expose boat position for Playwright testing when enabled
    try {
      // @ts-ignore
      if ((window as any).__PLAYWRIGHT_TESTING) {
        // Export actual rendered boat position (fixed) and orientation, along with route progress
        // @ts-ignore
        (window as any).__ROWER3D_POS = { 
          x: 0,  // Actual rendered x position (boat is fixed at origin)
          y: 0,  // Actual rendered y position
          z: 1.5,  // Actual rendered z position  
          progress: progressRef.current, 
          yaw: -yaw + Math.PI  // Actual boat orientation (faces forward)
        };
      }
    } catch (e) { /* ignore if window isn't available */ }

    // Dynamic pixel ratio autoscaling: if frames frequently slow, reduce DPR to improve performance
    try {
      if (performanceMode === 'auto') {
        if (delta > 0.05) {
          lastLongFrameRef.current += 1;
        } else {
          lastLongFrameRef.current = Math.max(0, lastLongFrameRef.current - 1);
        }
        if (lastLongFrameRef.current > 4) {
          gl.setPixelRatio(0.5);
        } else {
          gl.setPixelRatio(devicePixelRatio);
        }
      }
    } catch (e) { /* silent failures allowed */ }

    // Expose camera for e2e testing
    try {
      // @ts-ignore
      if ((window as any).__PLAYWRIGHT_TESTING) {
        // @ts-ignore
        (window as any).__ROWER3D_CAMERA = { position: camera.position.toArray(), rotation: camera.rotation.toArray() };
      }
    } catch (e) {}
  });

  return (
    <>
      {/* ambient light */}
      <ambientLight intensity={0.6} />
      <directionalLight position={[5, 5, 5]} intensity={0.6} />
      {/* water plane - moves backward with route to create illusion of movement */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[-posRef.current.x, -0.05, -posRef.current.z]}>
        <planeGeometry args={[500, 500, 8, 8]} />
        <meshStandardMaterial color={'#a7f3d0'} metalness={0.1} roughness={0.8} />
      </mesh>

      {/* Route line - moves backward to create illusion of forward movement */}
      {curve && (
        <group position={[-posRef.current.x, -posRef.current.y, -posRef.current.z]} rotation={[0, yawRef.current - Math.PI, 0]}>
          <Line points={curve.getPoints(200)} color={'#eab308'} lineWidth={3} />
        </group>
      )}

      {/* boat + oars */}
      <group ref={boatRef} position={[0, 0, 0]}>
        {/* Attempt to render a glTF model if present (in Suspense) else fallback to procedural scull */}
        {performanceMode !== 'low' ? (
          <Suspense fallback={null}>
            <GLTFBoat />
          </Suspense>
        ) : (
          <>
            {/* Procedural racing scull hull - narrow yellow boat */}
            <mesh position={[0, 0, 0]}>
              <boxGeometry args={[0.2, 0.1, 2.8]} />
              <meshStandardMaterial color={'#f5d742'} metalness={0.3} roughness={0.5} />
            </mesh>
            {/* Rower figure - red torso */}
            <mesh position={[0, 0.3, 0]}>
              <boxGeometry args={[0.24, 0.4, 0.3]} />
              <meshStandardMaterial color={'#cc3311'} />
            </mesh>
            {/* Rower head */}
            <mesh position={[0, 0.6, 0.05]}>
              <boxGeometry args={[0.16, 0.2, 0.1]} />
              <meshStandardMaterial color={'#cc3311'} />
            </mesh>
          </>
        )}
        {/* left oar pivot - positioned to side of boat */}
        <group position={[-0.35, 0.1, 0]}>
          <mesh ref={leftOarRef} position={[0, 0.1, 0.6]}>
            {/* Long oar shaft with blade */}
            <boxGeometry args={[0.04, 0.03, 1.5]} />
            <meshStandardMaterial color={'#4a3520'} />
          </mesh>
          {/* Oar blade */}
          <mesh ref={leftOarRef} position={[0, 0.1, 1.2]}>
            <boxGeometry args={[0.16, 0.05, 0.35]} />
            <meshStandardMaterial color={'#4a3520'} />
          </mesh>
        </group>
        {/* right oar pivot - positioned to side of boat */}
        <group position={[0.35, 0.1, 0]}>
          <mesh ref={rightOarRef} position={[0, 0.1, 0.6]}>
            {/* Long oar shaft with blade */}
            <boxGeometry args={[0.04, 0.03, 1.5]} />
            <meshStandardMaterial color={'#4a3520'} />
          </mesh>
          {/* Oar blade */}
          <mesh ref={rightOarRef} position={[0, 0.1, 1.2]}>
            <boxGeometry args={[0.16, 0.05, 0.35]} />
            <meshStandardMaterial color={'#4a3520'} />
          </mesh>
        </group>
      </group>
    </>
  );
};

export const Rower3D: React.FC<Rower3DProps> = (props) => {
  return (
    <div className="rower3d-canvas-container">
      {/* fallback marker for test automation if Canvas isn't created due to WebGL issues */}
      <div className="rower3d-fallback-marker" data-loaded="true" style={{ display: 'none' }} />
      <Canvas camera={{ position: [0, 5, 5], fov: 50 }}>
        <RowerScene {...props} />
      </Canvas>
    </div>
  );
};

export default Rower3D;
