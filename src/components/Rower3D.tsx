import React, { useRef, useMemo, useEffect, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { Physics } from '@react-three/rapier';
import type { WaterRoute } from '../types/index';
import { routeTotalDistanceMeters } from '../utils/geoUtils';
import { isWebGPUAvailable, isWebGLAvailable } from '../utils/gpuUtils';
import { usePhysicsEngine } from '../hooks/usePhysicsEngine';
import {
  createRouteCurve,
  getRoutePositionAtProgress,
  getCurveDistances,
  distanceToProgress,
} from './rower3d/curve';
import { getThemeConfig } from './rower3d/themeConfig';
import type { RouteTheme } from './rower3d/themeConfig';
import { AnimationProvider } from './rower3d/AnimationContext';
import { getRouteLandmarkConfig, LandmarkRenderer } from './routeLandmarks';
import { IS_TEST_MODE } from './rower3d/constants';
import type { GPUBackend, PerformanceMode } from './rower3d/constants';
import { WakeEffect, BladeEntryFoam, PMREMEnvironment, DriveSpray, FinishSplash, CausticsLight, DynamicPostFx } from './rower3d/effectComponents';
import { PhotorealisticWater, WaterReflectionPlane, MistLayer, CurvedWaterChannel } from './rower3d/waterComponents';
import { PineTrees, GroundCover } from './rower3d/vegetationComponents';
import { PhotorealisticSkydome, HorizonSilhouette } from './rower3d/skyComponents';
import { CurvedRiverbanks, CurvedLandscapeElements, ProceduralTerrain } from './rower3d/bankComponents';
import { RowingScull, BoatKinematicController } from './rower3d/boatComponents';
import { CrystalBledLandscape } from './rower3d/themes/CrystalBledScene';
import { GothicVeniceLandscape } from './rower3d/themes/GothicVeniceScene';
import { SteampunkHenleyLandscape } from './rower3d/themes/SteampunkHenleyScene';
import { DystopianThamesLandscape } from './rower3d/themes/DystopianThamesScene';
import { SciFiBostonLandscape } from './rower3d/themes/SciFiBostonScene';
import './Rower3D.css';

// Preload the scull GLB at module load time so the asset is cached before first render
useGLTF.preload('/models/scull.glb');

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
  performanceMode?: PerformanceMode;
  intensityFactor?: number;
  debugMode?: boolean;
}

// ============================================================================
// THEMED RIVERBANKS - Ground color varies by route theme
// ============================================================================
const ThemedRiverbanks: React.FC<{ boatZ: number; theme: RouteTheme }> = ({ boatZ, theme }) => {
  const bankColor = useMemo(() => getThemeConfig(theme).bank.flatColor, [theme]);
  
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
// ROWER SCENE - Inner R3F scene component
// ============================================================================
const RowerScene: React.FC<Rower3DProps> = ({ 
  route, 
  paceSPer500, 
  distanceMeters, 
  isPlaying, 
  cadence,
  intensityFactor,
  performanceMode = 'auto',
}) => {
  const { camera } = useThree();
  
  const routeTheme = useMemo(() => detectRouteTheme(route), [route]);
  const themeConfig = useMemo(() => getThemeConfig(routeTheme), [routeTheme]);
  const landmarkConfig = useMemo(
    () => getRouteLandmarkConfig(route?.name, route?.tags),
    [route?.name, route?.tags],
  );
  
  const routeCurve = useMemo(() => {
    return createRouteCurve(route.coordinates, 0.1);
  }, [route.coordinates]);
  
  const curveData = useMemo(() => {
    if (!routeCurve) return { distances: [], length: 0 };
    const distances = getCurveDistances(routeCurve);
    const length = distances[distances.length - 1] || 0;
    return { distances, length };
  }, [routeCurve]);
  
  const boatProgressRef = useRef<number>(0);
  const boatRotationRef = useRef<number>(0);
  const boatPositionRef = useRef<THREE.Vector3>(new THREE.Vector3(0, 0, 0));
  const scratchTangentRef = useRef<THREE.Vector3>(new THREE.Vector3());
  const [sceneryState, setSceneryState] = useState({ boatProgress: 0, boatZ: 0 });
  const { boatProgress, boatZ } = sceneryState;

  const boatGroupRef = useRef<THREE.Group>(null);
  const lastSceneryUpdateRef = useRef<number>(0);
  
  const totalDistance = useMemo(() => {
    return routeTotalDistanceMeters(route.coordinates);
  }, [route.coordinates]);

  const { boatStateRef, strokePhase, dispatchTick } = usePhysicsEngine();

  const strokeCycleTRef = useRef(0);
  const velocityRef = useRef(0);

  useFrame((state, delta) => {
    const pm5Data = {
      pace: paceSPer500 ?? undefined,
      power: undefined,
      cadence: cadence ?? undefined,
      distance: distanceMeters ?? 0,
      elapsedTime: 0,
    };
    let speedMps = dispatchTick(delta, pm5Data);
    velocityRef.current = boatStateRef.current.smoothedVelocityMps || speedMps;
    strokeCycleTRef.current = boatStateRef.current.strokeCycleT;
    
    if (intensityFactor && intensityFactor > 0) {
      speedMps *= intensityFactor;
    }
    
    let targetProgress = boatProgressRef.current;
    
    if (isPlaying && speedMps > 0 && totalDistance > 0 && curveData.length > 0) {
      const progressRate = (speedMps / totalDistance);
      targetProgress = Math.min(1, boatProgressRef.current + progressRate * delta);
      boatProgressRef.current = targetProgress;
    } else if (!isPlaying && distanceMeters !== null && distanceMeters !== undefined && totalDistance > 0) {
      targetProgress = distanceToProgress(
        distanceMeters,
        totalDistance,
        curveData.distances,
        curveData.length
      );
      boatProgressRef.current += (targetProgress - boatProgressRef.current) * delta * 3;
    }
    
    const routePos = getRoutePositionAtProgress(
      routeCurve,
      boatProgressRef.current,
      boatPositionRef.current,
      scratchTangentRef.current,
    );
    boatRotationRef.current = routePos.angle;
    
    if (boatGroupRef.current) {
      boatGroupRef.current.position.copy(boatPositionRef.current);
      boatGroupRef.current.rotation.y = boatRotationRef.current;
    }

    const elapsedTime = state.clock.elapsedTime;
    if (elapsedTime - lastSceneryUpdateRef.current > 0.1) {
      lastSceneryUpdateRef.current = elapsedTime;
      const newProgress = boatProgressRef.current;
      const newZ = boatPositionRef.current.z;
      setSceneryState(prev =>
        Math.abs(newProgress - prev.boatProgress) > 0.0001 || Math.abs(newZ - prev.boatZ) > 1
          ? { boatProgress: newProgress, boatZ: newZ }
          : prev
      );
    }
    
    const cameraDistance = 6;
    const cameraHeight = 2.5;
    const tangent = routePos.tangent;
    
    camera.position.set(
      boatPositionRef.current.x - tangent.x * cameraDistance,
      boatPositionRef.current.y + cameraHeight,
      boatPositionRef.current.z - tangent.z * cameraDistance
    );
    camera.lookAt(
      boatPositionRef.current.x,
      boatPositionRef.current.y + 0.3,
      boatPositionRef.current.z
    );
    
    try {
      if (IS_TEST_MODE) {
        window.__ROWER3D_POS = {
          x: boatPositionRef.current.x,
          y: boatPositionRef.current.y,
          z: boatPositionRef.current.z,
          progress: boatProgressRef.current,
          angle: boatRotationRef.current
        };
        window.__ROWER3D_CAMERA = {
          position: [camera.position.x, camera.position.y, camera.position.z]
        };
        window.__ROWER3D_ROUTE = {
          hasCurve: !!routeCurve,
          totalDistance,
          curveLength: curveData.length
        };
        window.__ROWER3D_SPEED_MPS = speedMps;
        window.__ROWER3D_STROKE_PHASE = boatStateRef.current.strokePhase;
        window.__ROWER3D_DISTANCE_M = boatProgressRef.current * totalDistance;
      }
    } catch { /* intentional: window access may fail in test environments */ }
  });
  
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
        return (
          <>
            <ProceduralTerrain side="left" boatZ={boatZ} />
            <ProceduralTerrain side="right" boatZ={boatZ} />
            <PineTrees side="left" boatZ={boatZ} theme={routeTheme} />
            <PineTrees side="right" boatZ={boatZ} theme={routeTheme} />
          </>
        );
    }
  };

  const sunLightPos = useMemo((): [number, number, number] => {
    const elevRad = (themeConfig.lighting.sunElevation * Math.PI) / 180;
    const azRad   = (themeConfig.lighting.sunAzimuth   * Math.PI) / 180;
    const scale   = 200;
    return [
      Math.cos(elevRad) * Math.sin(azRad) * scale,
      Math.sin(elevRad) * scale,
      Math.cos(elevRad) * Math.cos(azRad) * scale,
    ];
  }, [themeConfig.lighting.sunElevation, themeConfig.lighting.sunAzimuth]);

  const sunMeshRef = useRef<THREE.Mesh>(null!);
  const godRaysSunRef = performanceMode === 'high' ? sunMeshRef : undefined;

  return (
    <AnimationProvider>
      <fogExp2 attach="fog" args={[themeConfig.fog.color, themeConfig.fog.density]} />
      
      <PhotorealisticSkydome theme={routeTheme} boatZ={boatZ} />
      
      <hemisphereLight 
        args={[
          routeTheme === 'dystopian-thames' ? '#4a3728' : 
          routeTheme === 'gothic-venice' ? '#3d4f5f' :
          routeTheme === 'steampunk-henley' ? '#d4a574' :
          routeTheme === 'scifi-boston' ? '#1e3a5f' :
          '#b4d7ff',
          routeTheme === 'dystopian-thames' ? '#1a1a1a' :
          routeTheme === 'gothic-venice' ? '#2c3e50' :
          '#3d5c3a',
          routeTheme === 'dystopian-thames' || routeTheme === 'gothic-venice' ? 0.5 : 0.9
        ]} 
        position={[0, 50, 0]}
      />
      
      <directionalLight
        position={sunLightPos}
        intensity={themeConfig.lighting.sunIntensity}
        color={themeConfig.lighting.sunColor}
        castShadow={performanceMode !== 'low'}
        shadow-mapSize-width={performanceMode === 'high' ? 2048 : 1024}
        shadow-mapSize-height={performanceMode === 'high' ? 2048 : 1024}
        shadow-camera-near={0.1}
        shadow-camera-far={performanceMode === 'high' ? 200 : 300}
        shadow-camera-left={-100}
        shadow-camera-right={100}
        shadow-camera-top={100}
        shadow-camera-bottom={-100}
      />
      
      <ambientLight 
        intensity={themeConfig.lighting.ambientIntensity}
        color={themeConfig.lighting.ambientColor}
      />
      
      <directionalLight
        position={[-sunLightPos[0] * 0.6, 50, -sunLightPos[2] * 0.5]}
        intensity={themeConfig.lighting.fillIntensity}
        color={themeConfig.lighting.fillColor}
      />

      {!IS_TEST_MODE && performanceMode === 'high' && (
        <mesh ref={sunMeshRef} position={sunLightPos} frustumCulled={false}>
          <sphereGeometry args={[5, 8, 8]} />
          <meshBasicMaterial color={themeConfig.lighting.sunColor} />
        </mesh>
      )}
      
      <PMREMEnvironment theme={routeTheme} />
      
      {routeCurve ? (
        <CurvedWaterChannel curve={routeCurve} theme={routeTheme} />
      ) : (
        <PhotorealisticWater boatZ={boatZ} theme={routeTheme} performanceMode={performanceMode} />
      )}

      {!IS_TEST_MODE && performanceMode !== 'low' && !routeCurve && (
        <WaterReflectionPlane boatZ={boatZ} theme={routeTheme} />
      )}
      
      {routeCurve && (
        <CurvedRiverbanks curve={routeCurve} theme={routeTheme} />
      )}
      
      <MistLayer boatZ={boatZ} theme={routeTheme} />
      
      {!routeCurve && (
        <ThemedRiverbanks boatZ={boatZ} theme={routeTheme} />
      )}
      
      {routeCurve ? (
        <CurvedLandscapeElements curve={routeCurve} theme={routeTheme} boatProgress={boatProgress} />
      ) : (
        renderThemedLandscape()
      )}

      {landmarkConfig && (
        <group position={[0, 0, boatZ]}>
          <LandmarkRenderer config={landmarkConfig} />
        </group>
      )}
      
      {IS_TEST_MODE ? (
        <group ref={boatGroupRef}>
          <RowingScull cadence={cadence || 30} strokeCycleTRef={strokeCycleTRef} />
        </group>
      ) : (
        <PhysicsErrorBoundary fallback={
          <group ref={boatGroupRef}>
            <RowingScull cadence={cadence || 30} strokeCycleTRef={strokeCycleTRef} />
          </group>
        }>
          <Physics gravity={[0, -9.81, 0]}>
            <BoatKinematicController
              positionRef={boatPositionRef}
              rotationRef={boatRotationRef}
              cadence={cadence || 30}
              strokeCycleTRef={strokeCycleTRef}
            />
          </Physics>
        </PhysicsErrorBoundary>
      )}

      {!IS_TEST_MODE && (
        <WakeEffect
          positionRef={boatPositionRef}
          rotationRef={boatRotationRef}
          velocityRef={velocityRef}
        />
      )}

      {!IS_TEST_MODE && (
        <BladeEntryFoam
          positionRef={boatPositionRef}
          rotationRef={boatRotationRef}
          strokePhase={strokePhase}
          foamIntensity={themeConfig.water.foamIntensity}
        />
      )}

      {!IS_TEST_MODE && (
        <>
          <DriveSpray
            positionRef={boatPositionRef}
            rotationRef={boatRotationRef}
            strokePhase={strokePhase}
          />
          <FinishSplash
            positionRef={boatPositionRef}
            rotationRef={boatRotationRef}
            strokePhase={strokePhase}
          />
        </>
      )}

      {!IS_TEST_MODE && performanceMode !== 'low' && (
        <DynamicPostFx
          velocityRef={velocityRef}
          performanceMode={performanceMode}
          theme={routeTheme}
          sunMeshRef={godRaysSunRef}
        />
      )}

      {!IS_TEST_MODE && performanceMode !== 'low' && (
        <CausticsLight boatZ={boatZ} />
      )}

      {!IS_TEST_MODE && performanceMode !== 'low' && (
        <GroundCover boatZ={boatZ} theme={routeTheme} performanceMode={performanceMode} />
      )}

      {!IS_TEST_MODE && (
        <HorizonSilhouette boatZ={boatZ} theme={routeTheme} />
      )}
    </AnimationProvider>
  );
};

// ============================================================================
// PHYSICS ERROR BOUNDARY — isolates Rapier WASM failures so they don't tear
// down the whole Canvas. Falls back to an imperative group (same as Playwright mode).
// ============================================================================
class PhysicsErrorBoundary extends React.Component<
  { children: React.ReactNode; fallback: React.ReactNode },
  { hasError: boolean }
> {
  constructor(props: { children: React.ReactNode; fallback: React.ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.warn('PhysicsErrorBoundary: Rapier physics unavailable, using fallback', error, info);
  }

  render() {
    if (this.state.hasError) return this.props.fallback;
    return this.props.children;
  }
}

// ============================================================================
// GPU ERROR BOUNDARY
// ============================================================================
class GPUErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; errorMessage: string }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, errorMessage: '' };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, errorMessage: error?.message ?? String(error) };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('GPU Error Boundary caught error:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="rower3d-fallback-marker" data-loaded="true" style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '8px',
          height: '100%',
          color: '#888',
          fontSize: '13px',
          padding: '16px',
          textAlign: 'center',
        }}>
          <span>3D rendering error – GPU may not be available</span>
          {this.state.errorMessage && (
            <span style={{ fontSize: '11px', opacity: 0.7, maxWidth: '380px', wordBreak: 'break-word' }}>
              {this.state.errorMessage}
            </span>
          )}
          <button
            style={{ marginTop: '8px', padding: '6px 16px', cursor: 'pointer', fontSize: '12px' }}
            onClick={() => this.setState({ hasError: false, errorMessage: '' })}
          >
            Retry
          </button>
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
          dpr={isHighQuality ? [1, 2] : 1}
          gl={{
            antialias: isHighQuality,
            alpha: true,
            powerPreference: isHighQuality ? 'high-performance' : 'low-power',
            failIfMajorPerformanceCaveat: false,
            preserveDrawingBuffer: !!window.__PLAYWRIGHT_TESTING,
            toneMapping: THREE.ACESFilmicToneMapping,
            toneMappingExposure: 1.0,
          }}
          onCreated={({ gl }) => {
            gl.outputColorSpace = THREE.SRGBColorSpace;
            try {
              window.__ROWER3D_MAX_ANISOTROPY = gl.capabilities.getMaxAnisotropy();
            } catch { /* intentional */ }
            try {
              window.__ROWER3D_GPU_BACKEND = gpuBackend;
            } catch { /* intentional */ }
            
            const canvas = gl.domElement;
            canvas.addEventListener('webglcontextlost', (ev) => {
              try {
                ev.preventDefault?.();
                const marker = document.querySelector('.rower3d-fallback-marker') as HTMLElement | null;
                if (marker) marker.style.display = 'block';
                window.__ROWER3D_WEBGL_LOST = true;
              } catch { /* intentional */ }
            }, false);
            canvas.addEventListener('webglcontextrestored', () => {
              try {
                const marker = document.querySelector('.rower3d-fallback-marker') as HTMLElement | null;
                if (marker) marker.style.display = 'none';
                window.__ROWER3D_WEBGL_LOST = false;
              } catch { /* intentional */ }
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
