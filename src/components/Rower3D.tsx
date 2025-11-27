import React, { useRef, useMemo, useEffect } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { CatmullRomCurve3, Vector3, Mesh, Group } from 'three';
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
  intensityFactor?: number; // Speed adjustment factor from workout intensity (e.g., 0.6-1.2)
}

// Simple boat mesh is built in the scene below

const RowerScene: React.FC<Rower3DProps> = ({ route, paceSPer500, distanceMeters, isPlaying, cadence, performanceMode, intensityFactor }) => {
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
  const leftOarRef = useRef<Group | null>(null);
  const rightOarRef = useRef<Group | null>(null);
  const progressRef = useRef<number>(0);
  const posRef = useRef<Vector3>(new Vector3(0, 0, 0));
  const yawRef = useRef<number>(0);
  const distanceTraveledRef = useRef<number>(0); // Track distance for scenery scrolling
  
  // Scenery refs - these need to be updated in useFrame to move with the world
  const waterRef = useRef<Mesh | null>(null);
  const riverSceneryRef = useRef<Group | null>(null);
  const lakeSceneryRef = useRef<Group | null>(null);

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

  useFrame((_, delta: number) => {
    if (!curve || !boatRef.current) return;
    // compute effective speed using pace if given; pace is seconds/500m -> m/s = 500/pace
    let speedMps = 0;
    if (paceSPer500 && paceSPer500 > 0) speedMps = 500 / paceSPer500; // m/s
    
    // Apply intensity factor from structured workout if provided
    if (intensityFactor && intensityFactor > 0) {
      speedMps *= intensityFactor;
    }

    // convert to progress per second relative to route length
    const progressPerSecond = totalDistance > 0 ? (speedMps / totalDistance) : 0;

    if (isPlaying && speedMps > 0) {
      progressRef.current = Math.min(1, progressRef.current + progressPerSecond * delta);
      // Track actual distance traveled for scenery scrolling (scaled for visual effect)
      distanceTraveledRef.current += speedMps * delta * 0.01; // Scale factor for visual movement
    } else {
      // if not playing, smoothly follow targetProgress using damping
      progressRef.current += (targetProgress - progressRef.current) * Math.min(1, delta * 5);
    }

    // Get position and tangent from curve
    const pos = curve.getPointAt(progressRef.current);
    const tangent = curve.getTangentAt(progressRef.current).normalize();
    
    // Compute orientation from tangent (for world movement direction)
    const yaw = Math.atan2(tangent.z, tangent.x);
    
    // Store in refs for use in render
    posRef.current.copy(pos);
    yawRef.current = yaw;
    
    // Position boat in the lower-center of screen, pointing forward (away from camera)
    // Boat at origin, facing negative Z (forward into the scene)
    boatRef.current.position.set(0, 0, 0);
    boatRef.current.rotation.set(0, 0, 0); // Boat nose points toward negative Z

    // Camera positioned behind and slightly above the rower, looking forward horizontally
    // Lower camera angle to see horizon and boat together
    camera.position.set(0, 1.0, 3); // Close behind rower, at head height
    camera.lookAt(0, 0.5, -30); // Look ahead at eye level toward horizon

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
      oarSweep = Math.cos(phase / 0.4 * Math.PI / 2) * 0.6 - 0.3; // sweep forward/back
    } else {
      // Recovery phase (slower return) - 60% of cycle
      const recoveryPhase = (phase - Math.PI * 0.4) / (Math.PI * 1.6);
      oarSweep = -0.3 + recoveryPhase * 0.6; // return to start
    }
    
    // Left and right oars rotate around Y-axis for forward/back sweep motion
    // Blade feather rotates around Z-axis
    if (leftOarRef.current) {
      // Left oar: rotate around Y for sweep, Z for feather
      leftOarRef.current.rotation.set(0, oarSweep, bladeFeather);
    }
    if (rightOarRef.current) {
      // Right oar: opposite Y rotation for symmetric sculling motion
      rightOarRef.current.rotation.set(0, -oarSweep, -bladeFeather);
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
    
    // Update scenery position to move backward (creates illusion boat is moving forward)
    // Scenery scrolls in the -Z direction as the boat "moves forward"
    const scrollZ = distanceTraveledRef.current;
    if (waterRef.current) {
      waterRef.current.position.set(0, -0.05, -scrollZ);
    }
    if (riverSceneryRef.current) {
      riverSceneryRef.current.position.set(0, 0, -scrollZ);
    }
    if (lakeSceneryRef.current) {
      lakeSceneryRef.current.position.set(0, 0, -scrollZ);
    }
  });

  // Determine route type for scenery - memoize to ensure consistent detection
  const isLakeRoute = useMemo(() => {
    return route.tags?.includes('lake') || route.tags?.includes('alpine') || false;
  }, [route.tags]);
  
  const isRiverRoute = useMemo(() => {
    return route.tags?.includes('river') || route.tags?.includes('canal') || false;
  }, [route.tags]);

  // Seeded random generator factory for consistent positions
  const createSeededRandom = (initialSeed: number) => {
    let seed = initialSeed;
    return () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
  };

  // Generate tree positions for river/canal routes - use seeded positions for consistency
  // Include different tree types: pine, deciduous, and bush
  const treePositions = useMemo(() => {
    if (!isRiverRoute) return [];
    const trees: Array<{ 
      x: number; 
      z: number; 
      scale: number; 
      side: 'left' | 'right';
      type: 'pine' | 'deciduous' | 'bush';
      distanceFromWater: number;
    }> = [];
    const seededRandom = createSeededRandom(12345);
    
    // Generate trees extending forward (negative Z is ahead of the boat)
    for (let z = -400; z < 50; z += 3) {
      // Generate multiple trees/vegetation per z position for density
      const numLeft = 1 + Math.floor(seededRandom() * 2);
      const numRight = 1 + Math.floor(seededRandom() * 2);
      
      for (let i = 0; i < numLeft; i++) {
        const distanceFromWater = 6 + seededRandom() * 20;
        const treeTypeRand = seededRandom();
        const treeType = treeTypeRand < 0.4 ? 'pine' : (treeTypeRand < 0.7 ? 'deciduous' : 'bush');
        trees.push({
          x: -distanceFromWater,
          z: z + seededRandom() * 3 - 1.5,
          scale: treeType === 'bush' ? 0.3 + seededRandom() * 0.3 : 0.7 + seededRandom() * 0.6,
          side: 'left',
          type: treeType,
          distanceFromWater
        });
      }
      
      for (let i = 0; i < numRight; i++) {
        const distanceFromWater = 6 + seededRandom() * 20;
        const treeTypeRand = seededRandom();
        const treeType = treeTypeRand < 0.4 ? 'pine' : (treeTypeRand < 0.7 ? 'deciduous' : 'bush');
        trees.push({
          x: distanceFromWater,
          z: z + seededRandom() * 3 - 1.5,
          scale: treeType === 'bush' ? 0.3 + seededRandom() * 0.3 : 0.7 + seededRandom() * 0.6,
          side: 'right',
          type: treeType,
          distanceFromWater
        });
      }
    }
    return trees;
  }, [isRiverRoute]);

  // Generate vegetation positions (grass patches, flowers, reeds) for river routes
  const vegetationPositions = useMemo(() => {
    if (!isRiverRoute) return [];
    const vegetation: Array<{
      x: number;
      z: number;
      scale: number;
      type: 'grass' | 'flowers' | 'reeds';
      side: 'left' | 'right';
    }> = [];
    const seededRandom = createSeededRandom(67890);
    
    // Generate vegetation extending forward (negative Z is ahead)
    for (let z = -400; z < 50; z += 2) {
      // Reeds near water edge
      if (seededRandom() > 0.5) {
        vegetation.push({
          x: -4.5 - seededRandom() * 1.5,
          z: z + seededRandom() * 2,
          scale: 0.3 + seededRandom() * 0.2,
          type: 'reeds',
          side: 'left'
        });
      }
      if (seededRandom() > 0.5) {
        vegetation.push({
          x: 4.5 + seededRandom() * 1.5,
          z: z + seededRandom() * 2,
          scale: 0.3 + seededRandom() * 0.2,
          type: 'reeds',
          side: 'right'
        });
      }
      
      // Grass patches on banks
      if (seededRandom() > 0.3) {
        vegetation.push({
          x: -7 - seededRandom() * 8,
          z: z + seededRandom() * 2,
          scale: 0.4 + seededRandom() * 0.4,
          type: 'grass',
          side: 'left'
        });
      }
      if (seededRandom() > 0.3) {
        vegetation.push({
          x: 7 + seededRandom() * 8,
          z: z + seededRandom() * 2,
          scale: 0.4 + seededRandom() * 0.4,
          type: 'grass',
          side: 'right'
        });
      }
      
      // Flowers scattered
      if (seededRandom() > 0.7) {
        vegetation.push({
          x: -8 - seededRandom() * 10,
          z: z + seededRandom() * 2,
          scale: 0.15 + seededRandom() * 0.1,
          type: 'flowers',
          side: 'left'
        });
      }
      if (seededRandom() > 0.7) {
        vegetation.push({
          x: 8 + seededRandom() * 10,
          z: z + seededRandom() * 2,
          scale: 0.15 + seededRandom() * 0.1,
          type: 'flowers',
          side: 'right'
        });
      }
    }
    return vegetation;
  }, [isRiverRoute]);

  // Generate building positions for river routes
  const buildingPositions = useMemo(() => {
    if (!isRiverRoute) return [];
    const buildings: Array<{
      x: number;
      z: number;
      width: number;
      height: number;
      depth: number;
      roofType: 'flat' | 'pitched' | 'hip';
      color: string;
      roofColor: string;
      side: 'left' | 'right';
    }> = [];
    const seededRandom = createSeededRandom(11111);
    const buildingColors = ['#d4c4a8', '#c9b896', '#e8dcc8', '#a89880', '#b8a888'];
    const roofColors = ['#8b4513', '#654321', '#4a3520', '#5c3d2e', '#6b4226'];
    
    // Spread buildings sparsely along the route (negative Z is ahead)
    for (let z = -380; z < 50; z += 20) {
      // Chance to place building on left or right
      if (seededRandom() > 0.4) {
        const roofChoice = seededRandom();
        buildings.push({
          x: -20 - seededRandom() * 15,
          z: z + seededRandom() * 10 - 5,
          width: 2 + seededRandom() * 3,
          height: 2 + seededRandom() * 4,
          depth: 2 + seededRandom() * 3,
          roofType: roofChoice < 0.33 ? 'flat' : (roofChoice < 0.66 ? 'pitched' : 'hip'),
          color: buildingColors[Math.floor(seededRandom() * buildingColors.length)],
          roofColor: roofColors[Math.floor(seededRandom() * roofColors.length)],
          side: 'left'
        });
      }
      if (seededRandom() > 0.4) {
        const roofChoice = seededRandom();
        buildings.push({
          x: 20 + seededRandom() * 15,
          z: z + seededRandom() * 10 - 5,
          width: 2 + seededRandom() * 3,
          height: 2 + seededRandom() * 4,
          depth: 2 + seededRandom() * 3,
          roofType: roofChoice < 0.33 ? 'flat' : (roofChoice < 0.66 ? 'pitched' : 'hip'),
          color: buildingColors[Math.floor(seededRandom() * buildingColors.length)],
          roofColor: roofColors[Math.floor(seededRandom() * roofColors.length)],
          side: 'right'
        });
      }
    }
    return buildings;
  }, [isRiverRoute]);

  // Generate mountain positions for lake routes
  const mountainPositions = useMemo(() => {
    if (!isLakeRoute) return [];
    const mountains: Array<{ x: number; z: number; scaleX: number; scaleY: number; rotation: number }> = [];
    const seededRandom = createSeededRandom(54321);
    for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 6) {
      const distance = 80 + seededRandom() * 40;
      mountains.push({
        x: Math.cos(angle) * distance,
        z: Math.sin(angle) * distance,
        scaleX: 15 + seededRandom() * 20,
        scaleY: 8 + seededRandom() * 15,
        rotation: angle + seededRandom() * 0.3
      });
    }
    return mountains;
  }, [isLakeRoute]);

  // Generate lake shore features (trees, vegetation, buildings) around the lake
  const lakeShoreFeatures = useMemo(() => {
    if (!isLakeRoute) return { trees: [], vegetation: [], buildings: [] };
    const seededRandom = createSeededRandom(99999);
    
    const trees: Array<{
      x: number;
      z: number;
      scale: number;
      type: 'pine' | 'deciduous' | 'bush';
    }> = [];
    
    const vegetation: Array<{
      x: number;
      z: number;
      scale: number;
      type: 'grass' | 'flowers' | 'reeds';
    }> = [];
    
    const buildings: Array<{
      x: number;
      z: number;
      width: number;
      height: number;
      depth: number;
      roofType: 'flat' | 'pitched' | 'hip';
      color: string;
      roofColor: string;
      rotation: number;
    }> = [];
    
    const buildingColors = ['#d4c4a8', '#c9b896', '#e8dcc8', '#a89880', '#b8a888'];
    const roofColors = ['#8b4513', '#654321', '#4a3520', '#5c3d2e', '#6b4226'];
    
    // Generate features around the lake shore
    for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 12) {
      // Trees at various distances from shore
      for (let i = 0; i < 3; i++) {
        const distance = 62 + seededRandom() * 15;
        const treeTypeRand = seededRandom();
        const treeType = treeTypeRand < 0.5 ? 'pine' : (treeTypeRand < 0.7 ? 'deciduous' : 'bush');
        trees.push({
          x: Math.cos(angle + seededRandom() * 0.3) * distance,
          z: Math.sin(angle + seededRandom() * 0.3) * distance,
          scale: treeType === 'bush' ? 0.3 + seededRandom() * 0.3 : 0.6 + seededRandom() * 0.5,
          type: treeType
        });
      }
      
      // Vegetation near water
      if (seededRandom() > 0.4) {
        const vegTypeRand = seededRandom();
        vegetation.push({
          x: Math.cos(angle) * (60 + seededRandom() * 3),
          z: Math.sin(angle) * (60 + seededRandom() * 3),
          scale: 0.3 + seededRandom() * 0.2,
          type: vegTypeRand > 0.5 ? 'reeds' : 'grass'
        });
      }
      
      // Flowers
      if (seededRandom() > 0.6) {
        vegetation.push({
          x: Math.cos(angle + 0.1) * (63 + seededRandom() * 5),
          z: Math.sin(angle + 0.1) * (63 + seededRandom() * 5),
          scale: 0.15 + seededRandom() * 0.1,
          type: 'flowers'
        });
      }
      
      // Buildings (sparse, every few angles)
      if (seededRandom() > 0.7) {
        const roofChoice = seededRandom();
        buildings.push({
          x: Math.cos(angle) * (70 + seededRandom() * 10),
          z: Math.sin(angle) * (70 + seededRandom() * 10),
          width: 2 + seededRandom() * 2,
          height: 2 + seededRandom() * 3,
          depth: 2 + seededRandom() * 2,
          roofType: roofChoice < 0.33 ? 'flat' : (roofChoice < 0.66 ? 'pitched' : 'hip'),
          color: buildingColors[Math.floor(seededRandom() * buildingColors.length)],
          roofColor: roofColors[Math.floor(seededRandom() * roofColors.length)],
          rotation: angle
        });
      }
    }
    
    return { trees, vegetation, buildings };
  }, [isLakeRoute]);

  // Helper function to calculate perspective scale based on distance from camera
  // Objects further away appear smaller (camera is at z=3, looking forward toward negative Z)
  const calculatePerspectiveScale = (z: number, baseScale: number): number => {
    // Camera is at z=3, boat at z=0
    // Objects at z < 0 are ahead (in front of boat), z > 0 are behind
    const cameraZ = 3;
    const distanceFromCamera = Math.abs(z - cameraZ);
    // Use inverse distance for perspective - closer objects are larger
    const perspectiveFactor = Math.max(0.1, Math.min(3.0, 20 / (distanceFromCamera + 10)));
    return baseScale * perspectiveFactor;
  };

  return (
    <>
      {/* ambient light */}
      <ambientLight intensity={isLakeRoute ? 0.7 : 0.6} />
      <directionalLight position={[5, 10, 5]} intensity={isLakeRoute ? 0.8 : 0.6} castShadow />
      
      {/* Sky dome - visible horizon for all routes */}
      <mesh position={[0, 0, 0]}>
        <sphereGeometry args={[500, 32, 32]} />
        <meshBasicMaterial color={isLakeRoute ? '#87CEEB' : '#6eb5ff'} side={2} />
      </mesh>
      
      {/* Horizon line - distant land/fog */}
      <mesh position={[0, -10, -300]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[1000, 200]} />
        <meshBasicMaterial color={isLakeRoute ? '#a8d5ba' : '#8bc99a'} transparent opacity={0.7} />
      </mesh>
      
      {/* water plane - moves backward with route to create illusion of movement */}
      <mesh ref={waterRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.05, 0]}>
        <planeGeometry args={[500, 1000, 16, 16]} />
        <meshStandardMaterial 
          color={isLakeRoute ? '#3b82c4' : '#4a9eda'} 
          metalness={isLakeRoute ? 0.3 : 0.2} 
          roughness={isLakeRoute ? 0.4 : 0.6} 
        />
      </mesh>

      {/* RIVER SCENERY - grass banks and trees */}
      {isRiverRoute && (
        <group ref={riverSceneryRef}>
          {/* Left grass bank - extends forward (negative Z) */}
          <mesh 
            rotation={[-Math.PI / 2, 0, 0]} 
            position={[-15, 0.01, -200]}
          >
            <planeGeometry args={[25, 800]} />
            <meshStandardMaterial color={'#4ade80'} roughness={0.9} />
          </mesh>
          {/* Right grass bank */}
          <mesh 
            rotation={[-Math.PI / 2, 0, 0]} 
            position={[15, 0.01, -200]}
          >
            <planeGeometry args={[25, 800]} />
            <meshStandardMaterial color={'#4ade80'} roughness={0.9} />
          </mesh>
          {/* Left bank edge (darker grass) */}
          <mesh 
            rotation={[-Math.PI / 2, 0, 0]} 
            position={[-4, 0.02, -200]}
          >
            <planeGeometry args={[3, 800]} />
            <meshStandardMaterial color={'#22c55e'} roughness={0.9} />
          </mesh>
          {/* Right bank edge (darker grass) */}
          <mesh 
            rotation={[-Math.PI / 2, 0, 0]} 
            position={[4, 0.02, -200]}
          >
            <planeGeometry args={[3, 800]} />
            <meshStandardMaterial color={'#22c55e'} roughness={0.9} />
          </mesh>
          
          {/* Trees along the banks - with different types and perspective scaling */}
          {treePositions.map((tree, idx) => {
            const perspectiveScale = calculatePerspectiveScale(tree.z, tree.scale);
            
            if (tree.type === 'pine') {
              // Pine tree - layered cones
              return (
                <group 
                  key={`tree-${idx}`} 
                  position={[tree.x, 0, tree.z]}
                >
                  {/* Tree trunk */}
                  <mesh position={[0, perspectiveScale * 1.2, 0]}>
                    <cylinderGeometry args={[0.15 * perspectiveScale, 0.25 * perspectiveScale, perspectiveScale * 2.4, 8]} />
                    <meshStandardMaterial color={'#8B4513'} roughness={0.9} />
                  </mesh>
                  {/* Tree foliage - layered cones for pine tree look */}
                  <mesh position={[0, perspectiveScale * 2.8, 0]}>
                    <coneGeometry args={[perspectiveScale * 1.5, perspectiveScale * 2.5, 8]} />
                    <meshStandardMaterial color={'#228B22'} roughness={0.8} />
                  </mesh>
                  <mesh position={[0, perspectiveScale * 3.8, 0]}>
                    <coneGeometry args={[perspectiveScale * 1.2, perspectiveScale * 2, 8]} />
                    <meshStandardMaterial color={'#2d8f2d'} roughness={0.8} />
                  </mesh>
                  <mesh position={[0, perspectiveScale * 4.6, 0]}>
                    <coneGeometry args={[perspectiveScale * 0.8, perspectiveScale * 1.5, 8]} />
                    <meshStandardMaterial color={'#32a032'} roughness={0.8} />
                  </mesh>
                </group>
              );
            } else if (tree.type === 'deciduous') {
              // Deciduous tree - trunk with rounded foliage spheres
              return (
                <group 
                  key={`tree-${idx}`} 
                  position={[tree.x, 0, tree.z]}
                >
                  {/* Tree trunk */}
                  <mesh position={[0, perspectiveScale * 1.5, 0]}>
                    <cylinderGeometry args={[0.12 * perspectiveScale, 0.2 * perspectiveScale, perspectiveScale * 3, 8]} />
                    <meshStandardMaterial color={'#5c4033'} roughness={0.9} />
                  </mesh>
                  {/* Main foliage - large sphere */}
                  <mesh position={[0, perspectiveScale * 3.5, 0]}>
                    <sphereGeometry args={[perspectiveScale * 1.8, 12, 12]} />
                    <meshStandardMaterial color={'#3a7d44'} roughness={0.85} />
                  </mesh>
                  {/* Secondary foliage clusters */}
                  <mesh position={[perspectiveScale * 0.8, perspectiveScale * 3.2, 0]}>
                    <sphereGeometry args={[perspectiveScale * 1.0, 8, 8]} />
                    <meshStandardMaterial color={'#4a8b50'} roughness={0.85} />
                  </mesh>
                  <mesh position={[-perspectiveScale * 0.6, perspectiveScale * 3.6, perspectiveScale * 0.4]}>
                    <sphereGeometry args={[perspectiveScale * 0.9, 8, 8]} />
                    <meshStandardMaterial color={'#45a049'} roughness={0.85} />
                  </mesh>
                </group>
              );
            } else {
              // Bush - low rounded shape
              return (
                <group 
                  key={`tree-${idx}`} 
                  position={[tree.x, 0, tree.z]}
                >
                  {/* Bush main body */}
                  <mesh position={[0, perspectiveScale * 0.6, 0]}>
                    <sphereGeometry args={[perspectiveScale * 1.2, 8, 8]} />
                    <meshStandardMaterial color={'#2d5a27'} roughness={0.9} />
                  </mesh>
                  {/* Bush secondary mound */}
                  <mesh position={[perspectiveScale * 0.5, perspectiveScale * 0.4, 0]}>
                    <sphereGeometry args={[perspectiveScale * 0.8, 6, 6]} />
                    <meshStandardMaterial color={'#3d6d35'} roughness={0.9} />
                  </mesh>
                </group>
              );
            }
          })}
          
          {/* Vegetation - grass patches, flowers, and reeds */}
          {vegetationPositions.map((veg, idx) => {
            const perspectiveScale = calculatePerspectiveScale(veg.z, veg.scale);
            
            if (veg.type === 'reeds') {
              // Reeds near water - tall thin cylinders
              return (
                <group key={`veg-${idx}`} position={[veg.x, 0, veg.z]}>
                  {[0, 0.1, -0.1, 0.05, -0.05].map((offset, i) => (
                    <mesh key={i} position={[offset * perspectiveScale, perspectiveScale * 0.8, (i * 0.03) * perspectiveScale]}>
                      <cylinderGeometry args={[0.02 * perspectiveScale, 0.03 * perspectiveScale, perspectiveScale * 1.6, 4]} />
                      <meshStandardMaterial color={'#8b7355'} roughness={0.9} />
                    </mesh>
                  ))}
                  {/* Reed tops */}
                  {[0, 0.1, -0.1].map((offset, i) => (
                    <mesh key={`top-${i}`} position={[offset * perspectiveScale, perspectiveScale * 1.7, (i * 0.03) * perspectiveScale]}>
                      <coneGeometry args={[0.05 * perspectiveScale, 0.15 * perspectiveScale, 4]} />
                      <meshStandardMaterial color={'#a08060'} roughness={0.9} />
                    </mesh>
                  ))}
                </group>
              );
            } else if (veg.type === 'grass') {
              // Grass patch - small bumpy ground cover
              return (
                <group key={`veg-${idx}`} position={[veg.x, 0.02, veg.z]}>
                  <mesh rotation={[-Math.PI / 2, 0, 0]}>
                    <circleGeometry args={[perspectiveScale * 1.5, 8]} />
                    <meshStandardMaterial color={'#5cb85c'} roughness={0.95} />
                  </mesh>
                  {/* Small grass tufts */}
                  {[-0.3, 0, 0.3, -0.15, 0.15].map((offset, i) => (
                    <mesh key={i} position={[offset * perspectiveScale, perspectiveScale * 0.1, (i * 0.1 - 0.2) * perspectiveScale]}>
                      <coneGeometry args={[0.08 * perspectiveScale, perspectiveScale * 0.3, 4]} />
                      <meshStandardMaterial color={'#4ca64c'} roughness={0.95} />
                    </mesh>
                  ))}
                </group>
              );
            } else {
              // Flowers - small colorful dots
              const flowerColors = ['#ff6b6b', '#ffd93d', '#6bcb77', '#4d96ff', '#ff6b9d'];
              return (
                <group key={`veg-${idx}`} position={[veg.x, 0.05, veg.z]}>
                  {[0, 0.08, -0.08, 0.04, -0.04].map((offset, i) => (
                    <mesh key={i} position={[offset * perspectiveScale, perspectiveScale * 0.1, (i * 0.05 - 0.1) * perspectiveScale]}>
                      <sphereGeometry args={[perspectiveScale * 0.06, 6, 6]} />
                      <meshStandardMaterial color={flowerColors[i % flowerColors.length]} roughness={0.7} />
                    </mesh>
                  ))}
                  {/* Stems */}
                  {[0, 0.08, -0.08].map((offset, i) => (
                    <mesh key={`stem-${i}`} position={[offset * perspectiveScale, perspectiveScale * 0.05, (i * 0.05 - 0.1) * perspectiveScale]}>
                      <cylinderGeometry args={[0.01 * perspectiveScale, 0.01 * perspectiveScale, perspectiveScale * 0.1, 4]} />
                      <meshStandardMaterial color={'#228B22'} roughness={0.9} />
                    </mesh>
                  ))}
                </group>
              );
            }
          })}
          
          {/* Buildings on land */}
          {buildingPositions.map((building, idx) => {
            const perspectiveScale = calculatePerspectiveScale(building.z, 1);
            const scaledWidth = building.width * perspectiveScale;
            const scaledHeight = building.height * perspectiveScale;
            const scaledDepth = building.depth * perspectiveScale;
            
            return (
              <group key={`building-${idx}`} position={[building.x, 0, building.z]}>
                {/* Building main body */}
                <mesh position={[0, scaledHeight / 2, 0]}>
                  <boxGeometry args={[scaledWidth, scaledHeight, scaledDepth]} />
                  <meshStandardMaterial color={building.color} roughness={0.8} />
                </mesh>
                
                {/* Windows - simple dark rectangles */}
                {[-0.3, 0.3].map((xOffset, i) => (
                  <mesh 
                    key={`window-${i}`} 
                    position={[xOffset * scaledWidth, scaledHeight * 0.6, scaledDepth / 2 + 0.01]}
                  >
                    <planeGeometry args={[scaledWidth * 0.2, scaledHeight * 0.2]} />
                    <meshStandardMaterial color={'#1a365d'} roughness={0.5} />
                  </mesh>
                ))}
                
                {/* Door */}
                <mesh position={[0, scaledHeight * 0.25, scaledDepth / 2 + 0.01]}>
                  <planeGeometry args={[scaledWidth * 0.25, scaledHeight * 0.35]} />
                  <meshStandardMaterial color={'#5c4033'} roughness={0.7} />
                </mesh>
                
                {/* Roof */}
                {building.roofType === 'pitched' && (
                  <mesh position={[0, scaledHeight + scaledHeight * 0.2, 0]} rotation={[0, 0, 0]}>
                    <coneGeometry args={[scaledWidth * 0.8, scaledHeight * 0.4, 4]} />
                    <meshStandardMaterial color={building.roofColor} roughness={0.85} />
                  </mesh>
                )}
                {building.roofType === 'hip' && (
                  <mesh position={[0, scaledHeight + scaledHeight * 0.15, 0]}>
                    <coneGeometry args={[scaledWidth * 0.7, scaledHeight * 0.3, 8]} />
                    <meshStandardMaterial color={building.roofColor} roughness={0.85} />
                  </mesh>
                )}
                {building.roofType === 'flat' && (
                  <mesh position={[0, scaledHeight + 0.05 * perspectiveScale, 0]}>
                    <boxGeometry args={[scaledWidth * 1.05, 0.1 * perspectiveScale, scaledDepth * 1.05]} />
                    <meshStandardMaterial color={building.roofColor} roughness={0.85} />
                  </mesh>
                )}
                
                {/* Chimney for pitched/hip roofs */}
                {(building.roofType === 'pitched' || building.roofType === 'hip') && (
                  <mesh position={[scaledWidth * 0.25, scaledHeight + scaledHeight * 0.35, 0]}>
                    <boxGeometry args={[scaledWidth * 0.12, scaledHeight * 0.25, scaledDepth * 0.12]} />
                    <meshStandardMaterial color={'#8b4513'} roughness={0.9} />
                  </mesh>
                )}
              </group>
            );
          })}
        </group>
      )}

      {/* LAKE SCENERY - mountains around the lake */}
      {isLakeRoute && (
        <group ref={lakeSceneryRef}>
          {/* Distant shore all around */}
          <mesh 
            rotation={[-Math.PI / 2, 0, 0]} 
            position={[0, -0.02, 0]}
          >
            <ringGeometry args={[60, 200, 32]} />
            <meshStandardMaterial color={'#4ade80'} roughness={0.9} />
          </mesh>
          
          {/* Mountains around the lake */}
          {mountainPositions.map((mtn, idx) => (
            <group key={`mtn-${idx}`} position={[mtn.x, 0, mtn.z]} rotation={[0, mtn.rotation, 0]}>
              {/* Main mountain peak */}
              <mesh position={[0, mtn.scaleY / 2, 0]}>
                <coneGeometry args={[mtn.scaleX, mtn.scaleY, 8]} />
                <meshStandardMaterial color={'#6b7280'} roughness={0.9} />
              </mesh>
              {/* Snow cap */}
              <mesh position={[0, mtn.scaleY * 0.75, 0]}>
                <coneGeometry args={[mtn.scaleX * 0.4, mtn.scaleY * 0.35, 8]} />
                <meshStandardMaterial color={'#f8fafc'} roughness={0.7} />
              </mesh>
              {/* Secondary peak */}
              <mesh position={[mtn.scaleX * 0.5, mtn.scaleY * 0.3, mtn.scaleX * 0.2]}>
                <coneGeometry args={[mtn.scaleX * 0.6, mtn.scaleY * 0.6, 6]} />
                <meshStandardMaterial color={'#4b5563'} roughness={0.9} />
              </mesh>
              {/* Tree line at base */}
              <mesh position={[0, 1.5, 0]}>
                <cylinderGeometry args={[mtn.scaleX * 0.8, mtn.scaleX * 1.1, 3, 16]} />
                <meshStandardMaterial color={'#166534'} roughness={0.9} />
              </mesh>
            </group>
          ))}
          
          {/* Trees around the lake shore */}
          {lakeShoreFeatures.trees.map((tree, idx) => {
            const distance = Math.sqrt(tree.x * tree.x + tree.z * tree.z);
            // For lake, use distance from center for perspective
            const perspectiveScale = tree.scale * Math.max(0.4, Math.min(1.2, 80 / distance));
            
            if (tree.type === 'pine') {
              return (
                <group key={`lake-tree-${idx}`} position={[tree.x, 0, tree.z]}>
                  <mesh position={[0, perspectiveScale * 1.2, 0]}>
                    <cylinderGeometry args={[0.15 * perspectiveScale, 0.25 * perspectiveScale, perspectiveScale * 2.4, 8]} />
                    <meshStandardMaterial color={'#8B4513'} roughness={0.9} />
                  </mesh>
                  <mesh position={[0, perspectiveScale * 2.8, 0]}>
                    <coneGeometry args={[perspectiveScale * 1.5, perspectiveScale * 2.5, 8]} />
                    <meshStandardMaterial color={'#228B22'} roughness={0.8} />
                  </mesh>
                  <mesh position={[0, perspectiveScale * 3.8, 0]}>
                    <coneGeometry args={[perspectiveScale * 1.2, perspectiveScale * 2, 8]} />
                    <meshStandardMaterial color={'#2d8f2d'} roughness={0.8} />
                  </mesh>
                </group>
              );
            } else if (tree.type === 'deciduous') {
              return (
                <group key={`lake-tree-${idx}`} position={[tree.x, 0, tree.z]}>
                  <mesh position={[0, perspectiveScale * 1.5, 0]}>
                    <cylinderGeometry args={[0.12 * perspectiveScale, 0.2 * perspectiveScale, perspectiveScale * 3, 8]} />
                    <meshStandardMaterial color={'#5c4033'} roughness={0.9} />
                  </mesh>
                  <mesh position={[0, perspectiveScale * 3.5, 0]}>
                    <sphereGeometry args={[perspectiveScale * 1.8, 12, 12]} />
                    <meshStandardMaterial color={'#3a7d44'} roughness={0.85} />
                  </mesh>
                </group>
              );
            } else {
              return (
                <group key={`lake-tree-${idx}`} position={[tree.x, 0, tree.z]}>
                  <mesh position={[0, perspectiveScale * 0.6, 0]}>
                    <sphereGeometry args={[perspectiveScale * 1.2, 8, 8]} />
                    <meshStandardMaterial color={'#2d5a27'} roughness={0.9} />
                  </mesh>
                </group>
              );
            }
          })}
          
          {/* Vegetation around lake shore */}
          {lakeShoreFeatures.vegetation.map((veg, idx) => {
            const distance = Math.sqrt(veg.x * veg.x + veg.z * veg.z);
            const perspectiveScale = veg.scale * Math.max(0.4, Math.min(1.2, 80 / distance));
            
            if (veg.type === 'reeds') {
              return (
                <group key={`lake-veg-${idx}`} position={[veg.x, 0, veg.z]}>
                  {[0, 0.1, -0.1].map((offset, i) => (
                    <mesh key={i} position={[offset * perspectiveScale, perspectiveScale * 0.8, 0]}>
                      <cylinderGeometry args={[0.02 * perspectiveScale, 0.03 * perspectiveScale, perspectiveScale * 1.6, 4]} />
                      <meshStandardMaterial color={'#8b7355'} roughness={0.9} />
                    </mesh>
                  ))}
                </group>
              );
            } else if (veg.type === 'grass') {
              return (
                <group key={`lake-veg-${idx}`} position={[veg.x, 0.02, veg.z]}>
                  <mesh rotation={[-Math.PI / 2, 0, 0]}>
                    <circleGeometry args={[perspectiveScale * 1.5, 8]} />
                    <meshStandardMaterial color={'#5cb85c'} roughness={0.95} />
                  </mesh>
                </group>
              );
            } else {
              const flowerColors = ['#ff6b6b', '#ffd93d', '#6bcb77', '#4d96ff', '#ff6b9d'];
              return (
                <group key={`lake-veg-${idx}`} position={[veg.x, 0.05, veg.z]}>
                  {[0, 0.06, -0.06].map((offset, i) => (
                    <mesh key={i} position={[offset * perspectiveScale, perspectiveScale * 0.08, 0]}>
                      <sphereGeometry args={[perspectiveScale * 0.05, 6, 6]} />
                      <meshStandardMaterial color={flowerColors[i % flowerColors.length]} roughness={0.7} />
                    </mesh>
                  ))}
                </group>
              );
            }
          })}
          
          {/* Buildings around lake shore */}
          {lakeShoreFeatures.buildings.map((building, idx) => {
            const distance = Math.sqrt(building.x * building.x + building.z * building.z);
            const perspectiveScale = Math.max(0.5, Math.min(1.0, 80 / distance));
            const scaledWidth = building.width * perspectiveScale;
            const scaledHeight = building.height * perspectiveScale;
            const scaledDepth = building.depth * perspectiveScale;
            
            return (
              <group key={`lake-building-${idx}`} position={[building.x, 0, building.z]} rotation={[0, building.rotation, 0]}>
                <mesh position={[0, scaledHeight / 2, 0]}>
                  <boxGeometry args={[scaledWidth, scaledHeight, scaledDepth]} />
                  <meshStandardMaterial color={building.color} roughness={0.8} />
                </mesh>
                
                {/* Roof */}
                {building.roofType === 'pitched' && (
                  <mesh position={[0, scaledHeight + scaledHeight * 0.2, 0]}>
                    <coneGeometry args={[scaledWidth * 0.8, scaledHeight * 0.4, 4]} />
                    <meshStandardMaterial color={building.roofColor} roughness={0.85} />
                  </mesh>
                )}
                {building.roofType === 'hip' && (
                  <mesh position={[0, scaledHeight + scaledHeight * 0.15, 0]}>
                    <coneGeometry args={[scaledWidth * 0.7, scaledHeight * 0.3, 8]} />
                    <meshStandardMaterial color={building.roofColor} roughness={0.85} />
                  </mesh>
                )}
                {building.roofType === 'flat' && (
                  <mesh position={[0, scaledHeight + 0.05 * perspectiveScale, 0]}>
                    <boxGeometry args={[scaledWidth * 1.05, 0.1 * perspectiveScale, scaledDepth * 1.05]} />
                    <meshStandardMaterial color={building.roofColor} roughness={0.85} />
                  </mesh>
                )}
              </group>
            );
          })}
        </group>
      )}

      {/* Route line removed - now shown in top-right map overlay */}

      {/* boat + oars */}
      <group ref={boatRef} position={[0, 0, 0]}>
        {/* Racing scull hull - sleek narrow boat shape */}
        {/* Main hull body */}
        <mesh position={[0, 0.02, 0]}>
          <boxGeometry args={[0.32, 0.08, 4.0]} />
          <meshStandardMaterial color={'#f5c542'} metalness={0.4} roughness={0.3} />
        </mesh>
        {/* Hull bottom curve simulation - center keel */}
        <mesh position={[0, -0.02, 0]} rotation={[0, 0, Math.PI / 4]}>
          <boxGeometry args={[0.18, 0.18, 3.8]} />
          <meshStandardMaterial color={'#e8b732'} metalness={0.4} roughness={0.3} />
        </mesh>
        {/* Bow (front) - pointed */}
        <mesh position={[0, 0.01, -2.1]} scale={[0.6, 0.5, 1]} rotation={[Math.PI / 2, 0, 0]}>
          <coneGeometry args={[0.18, 0.6, 8]} />
          <meshStandardMaterial color={'#f5c542'} metalness={0.4} roughness={0.3} />
        </mesh>
        {/* Stern (back) - tapered */}
        <mesh position={[0, 0.01, 2.0]} scale={[0.5, 0.4, 0.8]} rotation={[-Math.PI / 2, 0, 0]}>
          <coneGeometry args={[0.2, 0.5, 8]} />
          <meshStandardMaterial color={'#f5c542'} metalness={0.4} roughness={0.3} />
        </mesh>
        {/* Gunwales (side rails) - left */}
        <mesh position={[-0.15, 0.08, 0]}>
          <boxGeometry args={[0.03, 0.04, 3.6]} />
          <meshStandardMaterial color={'#d4a832'} metalness={0.3} roughness={0.4} />
        </mesh>
        {/* Gunwales (side rails) - right */}
        <mesh position={[0.15, 0.08, 0]}>
          <boxGeometry args={[0.03, 0.04, 3.6]} />
          <meshStandardMaterial color={'#d4a832'} metalness={0.3} roughness={0.4} />
        </mesh>
        {/* Seat (sliding) */}
        <mesh position={[0, 0.12, 0.15]}>
          <boxGeometry args={[0.28, 0.03, 0.25]} />
          <meshStandardMaterial color={'#2a2a2a'} metalness={0.2} roughness={0.6} />
        </mesh>
        {/* Foot stretcher */}
        <mesh position={[0, 0.06, -0.5]} rotation={[0.3, 0, 0]}>
          <boxGeometry args={[0.26, 0.02, 0.18]} />
          <meshStandardMaterial color={'#1a1a1a'} />
        </mesh>
        
        {/* ROWER - more realistic human figure */}
        {/* Pelvis/hips */}
        <mesh position={[0, 0.18, 0.15]}>
          <boxGeometry args={[0.28, 0.12, 0.2]} />
          <meshStandardMaterial color={'#1a1a1a'} />
        </mesh>
        {/* Torso/chest */}
        <mesh position={[0, 0.38, 0.1]}>
          <boxGeometry args={[0.32, 0.28, 0.18]} />
          <meshStandardMaterial color={'#2563eb'} />
        </mesh>
        {/* Shoulders */}
        <mesh position={[0, 0.52, 0.08]}>
          <boxGeometry args={[0.42, 0.1, 0.14]} />
          <meshStandardMaterial color={'#2563eb'} />
        </mesh>
        {/* Neck */}
        <mesh position={[0, 0.6, 0.08]}>
          <cylinderGeometry args={[0.05, 0.06, 0.08, 12]} />
          <meshStandardMaterial color={'#d4a574'} />
        </mesh>
        {/* Head */}
        <mesh position={[0, 0.72, 0.08]}>
          <sphereGeometry args={[0.1, 16, 16]} />
          <meshStandardMaterial color={'#d4a574'} />
        </mesh>
        {/* Hair/cap */}
        <mesh position={[0, 0.78, 0.06]}>
          <sphereGeometry args={[0.08, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
          <meshStandardMaterial color={'#2a1a0a'} />
        </mesh>
        {/* Left upper arm */}
        <mesh position={[-0.26, 0.48, 0.08]} rotation={[0, 0, 0.4]}>
          <capsuleGeometry args={[0.04, 0.18, 8, 12]} />
          <meshStandardMaterial color={'#2563eb'} />
        </mesh>
        {/* Right upper arm */}
        <mesh position={[0.26, 0.48, 0.08]} rotation={[0, 0, -0.4]}>
          <capsuleGeometry args={[0.04, 0.18, 8, 12]} />
          <meshStandardMaterial color={'#2563eb'} />
        </mesh>
        {/* Left forearm */}
        <mesh position={[-0.38, 0.38, 0.05]} rotation={[0, 0, 0.8]}>
          <capsuleGeometry args={[0.035, 0.16, 8, 12]} />
          <meshStandardMaterial color={'#d4a574'} />
        </mesh>
        {/* Right forearm */}
        <mesh position={[0.38, 0.38, 0.05]} rotation={[0, 0, -0.8]}>
          <capsuleGeometry args={[0.035, 0.16, 8, 12]} />
          <meshStandardMaterial color={'#d4a574'} />
        </mesh>
        {/* Left thigh */}
        <mesh position={[-0.1, 0.14, -0.1]} rotation={[1.2, 0, 0]}>
          <capsuleGeometry args={[0.055, 0.28, 8, 12]} />
          <meshStandardMaterial color={'#1a1a1a'} />
        </mesh>
        {/* Right thigh */}
        <mesh position={[0.1, 0.14, -0.1]} rotation={[1.2, 0, 0]}>
          <capsuleGeometry args={[0.055, 0.28, 8, 12]} />
          <meshStandardMaterial color={'#1a1a1a'} />
        </mesh>
        {/* Left shin */}
        <mesh position={[-0.1, 0.08, -0.38]} rotation={[0.3, 0, 0]}>
          <capsuleGeometry args={[0.04, 0.24, 8, 12]} />
          <meshStandardMaterial color={'#1a1a1a'} />
        </mesh>
        {/* Right shin */}
        <mesh position={[0.1, 0.08, -0.38]} rotation={[0.3, 0, 0]}>
          <capsuleGeometry args={[0.04, 0.24, 8, 12]} />
          <meshStandardMaterial color={'#1a1a1a'} />
        </mesh>

        {/* LEFT OAR - realistic sculling oar */}
        <group ref={leftOarRef} position={[-0.18, 0.12, 0.05]}>
          {/* Oarlock/rigger attachment */}
          <mesh position={[-0.08, 0.04, 0]}>
            <cylinderGeometry args={[0.025, 0.025, 0.06, 8]} />
            <meshStandardMaterial color={'#666666'} metalness={0.8} roughness={0.2} />
          </mesh>
          {/* Oar handle (inboard) */}
          <mesh position={[0.15, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.022, 0.018, 0.4, 12]} />
            <meshStandardMaterial color={'#8B4513'} roughness={0.7} />
          </mesh>
          {/* Oar shaft (outboard) */}
          <mesh position={[-0.7, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.018, 0.022, 1.4, 12]} />
            <meshStandardMaterial color={'#654321'} roughness={0.5} />
          </mesh>
          {/* Oar blade - hatchet shape */}
          <mesh position={[-1.5, 0, 0]} rotation={[0, 0, 0]}>
            <boxGeometry args={[0.5, 0.015, 0.16]} />
            <meshStandardMaterial color={'#1e40af'} metalness={0.1} roughness={0.3} />
          </mesh>
          {/* Blade spine */}
          <mesh position={[-1.5, 0.012, 0]} rotation={[0, 0, 0]}>
            <boxGeometry args={[0.48, 0.015, 0.03]} />
            <meshStandardMaterial color={'#1e3a8a'} />
          </mesh>
        </group>

        {/* RIGHT OAR - realistic sculling oar */}
        <group ref={rightOarRef} position={[0.18, 0.12, 0.05]}>
          {/* Oarlock/rigger attachment */}
          <mesh position={[0.08, 0.04, 0]}>
            <cylinderGeometry args={[0.025, 0.025, 0.06, 8]} />
            <meshStandardMaterial color={'#666666'} metalness={0.8} roughness={0.2} />
          </mesh>
          {/* Oar handle (inboard) */}
          <mesh position={[-0.15, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.022, 0.018, 0.4, 12]} />
            <meshStandardMaterial color={'#8B4513'} roughness={0.7} />
          </mesh>
          {/* Oar shaft (outboard) */}
          <mesh position={[0.7, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.018, 0.022, 1.4, 12]} />
            <meshStandardMaterial color={'#654321'} roughness={0.5} />
          </mesh>
          {/* Oar blade - hatchet shape */}
          <mesh position={[1.5, 0, 0]} rotation={[0, 0, 0]}>
            <boxGeometry args={[0.5, 0.015, 0.16]} />
            <meshStandardMaterial color={'#1e40af'} metalness={0.1} roughness={0.3} />
          </mesh>
          {/* Blade spine */}
          <mesh position={[1.5, 0.012, 0]} rotation={[0, 0, 0]}>
            <boxGeometry args={[0.48, 0.015, 0.03]} />
            <meshStandardMaterial color={'#1e3a8a'} />
          </mesh>
        </group>
      </group>
    </>
  );
};

// Error boundary component for graceful WebGL failure handling
class WebGLErrorBoundary extends React.Component<
  { children: React.ReactNode; fallback?: React.ReactNode },
  { hasError: boolean }
> {
  constructor(props: { children: React.ReactNode; fallback?: React.ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): { hasError: boolean } {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.warn('WebGL Error Boundary caught error:', error, errorInfo);
    // Expose error state for testing
    try {
      (window as Window & { __ROWER3D_ERROR?: boolean }).__ROWER3D_ERROR = true;
    } catch {
      // Ignore errors when window is not available
    }
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback || (
        <div className="rower3d-fallback-marker" data-loaded="true" style={{ 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'center',
          height: '100%',
          color: '#888'
        }}>
          3D view unavailable
        </div>
      );
    }
    return this.props.children;
  }
}

export const Rower3D: React.FC<Rower3DProps> = (props) => {
  return (
    <div className="rower3d-canvas-container">
      {/* fallback marker for test automation if Canvas isn't created due to WebGL issues */}
      <div className="rower3d-fallback-marker" data-loaded="true" style={{ display: 'none' }} />
      <WebGLErrorBoundary>
        <Canvas 
          camera={{ position: [0, 1.0, 3], fov: 70 }}
          gl={{
            // WebGL-safe options for CI/headless environments
            antialias: false,
            alpha: true,
            powerPreference: 'low-power',
            failIfMajorPerformanceCaveat: false,
            preserveDrawingBuffer: true,
          }}
          onCreated={({ gl }) => {
            // Additional context loss handling setup
            gl.domElement.addEventListener('webglcontextlost', (e) => {
              e.preventDefault();
              console.warn('WebGL context lost in Canvas');
            });
          }}
        >
          <RowerScene {...props} />
        </Canvas>
      </WebGLErrorBoundary>
    </div>
  );
};

export default Rower3D;
