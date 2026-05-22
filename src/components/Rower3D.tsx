import React, { useRef, useMemo, useEffect, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Environment, Sky, Cloud, useCubeCamera, useGLTF } from '@react-three/drei';
import { EffectComposer, Bloom, ToneMapping, Vignette, DepthOfField } from '@react-three/postprocessing';
import { ToneMappingMode, ChromaticAberrationEffect } from 'postprocessing';
import * as THREE from 'three';
import { Physics, RigidBody } from '@react-three/rapier';
import type { RapierRigidBody } from '@react-three/rapier';
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
import './Rower3D.css';

declare global {
  interface Window {
    __PLAYWRIGHT_TESTING?: boolean;
  }
}

/** True when running under Playwright automation. Set before the SPA boots and never toggled. */
const IS_TEST_MODE = typeof window !== 'undefined' && !!window.__PLAYWRIGHT_TESTING;

// Preload the scull GLB at module load time so the asset is cached before first render
useGLTF.preload('/models/scull.glb');

// ============================================================================
// GPS TO 3D PATH CONVERSION — see ./rower3d/curve.ts for the pure helpers.
// ============================================================================

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

// Deterministic seeded pseudo-random — avoids Math.random() impurity in render.
// Returns a stable value in [0, 1) for a given seed integer.
function seededRandom(seed: number): number {
  const s = Math.sin(seed * 9301 + 49297) * 233280;
  return s - Math.floor(s);
}

// ============================================================================
// GPU GERSTNER WAVE SHADER — injected into MeshPhysicalMaterial via
// onBeforeCompile so all PBR features (IOR, transmission, env reflections)
// are preserved while waves run entirely on the GPU.
// ============================================================================

/**
 * Attach Gerstner wave vertex shader injection to a MeshPhysicalMaterial.
 *
 * @param mat          The material to modify (mutated in place).
 * @param timeUniform  Shared `{ value: number }` uniform updated each frame.
 * @param heightAxis   'z' → PlaneGeometry rotated -PI/2 (height is local Z);
 *                     'y' → horizontal custom geometry (height is local Y).
 * @param cacheKey     Unique string so Three.js recompiles when theme changes.
 */
function attachGerstnerShader(
  mat: THREE.MeshPhysicalMaterial,
  timeUniform: { value: number },
  heightAxis: 'y' | 'z',
  cacheKey: string,
): void {
  // Horizontal position axes in local vertex space
  const waveXY = heightAxis === 'z'
    ? 'vec2(position.x, position.y)'   // PlaneGeometry: local XY = horizontal
    : 'vec2(position.x, position.z)';  // Custom horiz geometry: local XZ

  const glslFunctions = `
    uniform float uTime;
    // Gerstner wave height contribution
    float gWave(vec2 p, vec2 dir, float amp, float freq, float spd) {
      vec2 nd = normalize(dir);
      return amp * sin(dot(nd, p) * freq - spd * uTime);
    }
    // Gerstner wave surface gradient (dh/dX, dh/dY)
    vec2 gWaveGrad(vec2 p, vec2 dir, float amp, float freq, float spd) {
      vec2 nd = normalize(dir);
      return amp * freq * nd * cos(dot(nd, p) * freq - spd * uTime);
    }
  `;

  // Normal injection — must come BEFORE begin_vertex in Three.js chunk order
  const normalChunk = `
    vec2 wXY = ${waveXY};
    vec2 wGrad = gWaveGrad(wXY, vec2( 1.0,  0.3), 0.15, 0.020, 0.80)
               + gWaveGrad(wXY, vec2(-0.3,  1.0), 0.12, 0.025, 0.60)
               + gWaveGrad(wXY, vec2( 0.7,  0.7), 0.08, 0.015, 1.10)
               + gWaveGrad(wXY, vec2( 0.5, -0.5), 0.04, 0.050, 1.50);
    vec3 objectNormal = normalize(vec3(-wGrad.x, -wGrad.y, 1.0));
    #ifdef USE_TANGENT
      vec3 objectTangent = vec3(tangent.xyz);
    #endif
  `;

  // Position injection — wXY is already in scope from the normal chunk above
  const heightDisplace = heightAxis === 'z'
    ? 'vec3(position.x, position.y, position.z + wH)'
    : 'vec3(position.x, position.y + wH, position.z)';

  const positionChunk = `
    float wH = gWave(wXY, vec2( 1.0,  0.3), 0.15, 0.020, 0.80)
             + gWave(wXY, vec2(-0.3,  1.0), 0.12, 0.025, 0.60)
             + gWave(wXY, vec2( 0.7,  0.7), 0.08, 0.015, 1.10)
             + gWave(wXY, vec2( 0.5, -0.5), 0.04, 0.050, 1.50);
    vec3 transformed = ${heightDisplace};
  `;

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = timeUniform;
    // Prepend helper functions before void main()
    shader.vertexShader = glslFunctions + shader.vertexShader;
    shader.vertexShader = shader.vertexShader
      .replace('#include <beginnormal_vertex>', normalChunk)
      .replace('#include <begin_vertex>',      positionChunk);
  };
  mat.customProgramCacheKey = () => `gerstner-${cacheKey}`;
}

// ============================================================================
// WAKE EFFECT — V-shaped Kelvin wake trailing behind the boat, velocity-scaled
// ============================================================================
const WakeEffect: React.FC<{
  positionRef: React.MutableRefObject<THREE.Vector3>;
  rotationRef: React.MutableRefObject<number>;
  velocityRef: React.MutableRefObject<number>;
}> = ({ positionRef, rotationRef, velocityRef }) => {
  const groupRef    = useRef<THREE.Group>(null);
  const leftMatRef  = useRef<THREE.MeshBasicMaterial>(null);
  const rightMatRef = useRef<THREE.MeshBasicMaterial>(null);
  const sternMatRef = useRef<THREE.MeshBasicMaterial>(null);

  // Kelvin wake half-angle ≈ 19.47°
  const HALF_ANGLE = Math.PI / 9.2; // ~19.6°
  const WAKE_LEN = 5;               // scene units (= metres)

  useFrame(() => {
    const g = groupRef.current;
    if (!g) return;

    const vel = velocityRef.current;
    g.position.copy(positionRef.current);
    g.rotation.y = rotationRef.current;

    // Opacity proportional to speed; invisible when nearly stopped
    const alpha = Math.min(vel / 2.5, 1.0) * 0.3;
    const visible = vel > 0.15;
    for (const matRef of [leftMatRef, rightMatRef, sternMatRef]) {
      if (matRef.current) {
        matRef.current.opacity  = alpha;
        matRef.current.visible  = visible;
      }
    }
    // Scale wake length with velocity
    const s = Math.min(vel / 4.17, 1.0);
    g.scale.set(s, 1, s);
  });

  // Arm geometry: thin plane oriented along the wake arm direction
  const armAngle = HALF_ANGLE;
  const halfLen  = WAKE_LEN / 2;

  return (
    <group ref={groupRef}>
      {/* Left V-arm (spreads to local -X, extends in local -Z behind boat) */}
      <mesh
        position={[-Math.sin(armAngle) * halfLen, -0.07, -Math.cos(armAngle) * halfLen]}
        rotation={[-Math.PI / 2, 0, armAngle]}
      >
        <planeGeometry args={[0.35, WAKE_LEN, 1, 8]} />
        <meshBasicMaterial
          ref={leftMatRef}
          color="white"
          transparent
          opacity={0}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* Right V-arm */}
      <mesh
        position={[Math.sin(armAngle) * halfLen, -0.07, -Math.cos(armAngle) * halfLen]}
        rotation={[-Math.PI / 2, 0, -armAngle]}
      >
        <planeGeometry args={[0.35, WAKE_LEN, 1, 8]} />
        <meshBasicMaterial
          ref={rightMatRef}
          color="white"
          transparent
          opacity={0}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* Central stern wash — turbulent water directly behind boat */}
      <mesh position={[0, -0.07, -halfLen * 0.6]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[1.2, halfLen * 1.2, 1, 4]} />
        <meshBasicMaterial
          ref={sternMatRef}
          color="white"
          transparent
          opacity={0}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>
    </group>
  );
};

// ============================================================================
// BLADE ENTRY FOAM — white foam sprites at oar-blade entry on the catch phase
// ============================================================================
const BladeEntryFoam: React.FC<{
  positionRef: React.MutableRefObject<THREE.Vector3>;
  rotationRef: React.MutableRefObject<number>;
  strokePhase: string;
}> = ({ positionRef, rotationRef, strokePhase }) => {
  const leftRef  = useRef<THREE.Mesh>(null);
  const rightRef = useRef<THREE.Mesh>(null);
  const leftMatRef  = useRef<THREE.MeshBasicMaterial>(null);
  const rightMatRef = useRef<THREE.MeshBasicMaterial>(null);

  // Foam life: decays from 1 → 0 over ~0.6 s, reset on each catch
  const foamLifeRef = useRef(0);
  const prevPhaseRef = useRef('recovery');

  useFrame((_, delta) => {
    const left  = leftRef.current;
    const right = rightRef.current;
    const lMat  = leftMatRef.current;
    const rMat  = rightMatRef.current;
    if (!left || !right || !lMat || !rMat) return;

    // Detect transition to catch phase → reset foam life
    if (strokePhase === 'catch' && prevPhaseRef.current !== 'catch') {
      foamLifeRef.current = 1.0;
    }
    prevPhaseRef.current = strokePhase;

    // Decay foam
    foamLifeRef.current = Math.max(0, foamLifeRef.current - delta / 0.6);
    const alpha = foamLifeRef.current * 0.65;

    // Position foam at oar-blade entry (oar span ≈ ±3.2 units from boat centre)
    const pos = positionRef.current;
    const rot = rotationRef.current;
    const cosR = Math.cos(rot);
    const sinR = Math.sin(rot);
    const span = 3.2;

    left.position.set(
      pos.x - cosR * span,
      pos.y - 0.05,
      pos.z + sinR * span,
    );
    right.position.set(
      pos.x + cosR * span,
      pos.y - 0.05,
      pos.z - sinR * span,
    );

    lMat.opacity = alpha;
    rMat.opacity = alpha;
    lMat.visible = alpha > 0.01;
    rMat.visible = alpha > 0.01;
  });

  return (
    <>
      <mesh ref={leftRef} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.55, 12]} />
        <meshBasicMaterial
          ref={leftMatRef}
          color="white"
          transparent
          opacity={0}
          depthWrite={false}
        />
      </mesh>
      <mesh ref={rightRef} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.55, 12]} />
        <meshBasicMaterial
          ref={rightMatRef}
          color="white"
          transparent
          opacity={0}
          depthWrite={false}
        />
      </mesh>
    </>
  );
};

// ============================================================================
// WATER REFLECTION PROBE — CubeCamera that provides real-time env reflections
// Updates every 30 frames so performance cost is amortised. The water mesh is
// temporarily hidden during the render pass to prevent self-reflection artefacts.
// ============================================================================
const WaterReflectionProbe: React.FC<{
  materialRef: React.MutableRefObject<THREE.MeshPhysicalMaterial | null>;
  meshRef: React.MutableRefObject<THREE.Mesh | null>;
}> = ({ materialRef, meshRef }) => {
  const { fbo, update } = useCubeCamera({ resolution: 64, near: 0.5, far: 600 });
  const frameRef = useRef(0);

  useFrame(() => {
    frameRef.current++;
    if (frameRef.current % 30 !== 0) return;
    // Hide water surface so it doesn't self-reflect
    if (meshRef.current) meshRef.current.visible = false;
    update();
    if (meshRef.current) meshRef.current.visible = true;
    if (materialRef.current) {
      materialRef.current.envMap = fbo.texture;
      materialRef.current.envMapIntensity = 0.35;
    }
  });

  return null;
};

// ============================================================================
// HIGH-DEFINITION PHOTOREALISTIC WATER - Advanced PBR with realistic waves,
// subsurface scattering simulation, and theme-appropriate depth effects
// ============================================================================
const PhotorealisticWater: React.FC<{ boatZ: number; theme: RouteTheme; isHighQuality: boolean }> = ({ boatZ, theme, isHighQuality }) => {
  const materialRef    = useRef<THREE.MeshPhysicalMaterial>(null);
  const meshRef        = useRef<THREE.Mesh>(null);
  const timeUniformRef = useRef({ value: 0 });

  // HD Theme-based water configurations with enhanced realism
  const waterConfig = useMemo(() => {
    switch (theme) {
      case 'crystal-bled':
        // Crystal-clear alpine lake - high visibility, turquoise tint
        return { 
          color: '#3a9db8', 
          transmission: 0.65, 
          roughness: 0.04, 
          thickness: 3.5,
          emissive: '#00e5ff', 
          emissiveIntensity: 0.06,
          attenuationColor: '#00a8cc',
          attenuationDistance: 8.0,
          specularIntensity: 1.2,
          sheenColor: '#80deea'
        };
      case 'gothic-venice':
        // Murky canal water - low visibility, greenish-brown, mysterious
        return { 
          color: '#1e3a3a', 
          transmission: 0.22, 
          roughness: 0.18, 
          thickness: 1.5,
          emissive: '#0a3d62', 
          emissiveIntensity: 0.015,
          attenuationColor: '#1a2f2f',
          attenuationDistance: 2.0,
          specularIntensity: 0.6,
          sheenColor: '#2a4a4a'
        };
      case 'steampunk-henley':
        // English river - slightly murky, warm green-brown tones
        return { 
          color: '#3a4a38', 
          transmission: 0.28, 
          roughness: 0.15, 
          thickness: 2.0,
          emissive: '#4a6741', 
          emissiveIntensity: 0.008,
          attenuationColor: '#3a4a38',
          attenuationDistance: 3.0,
          specularIntensity: 0.8,
          sheenColor: '#5a7a58'
        };
      case 'dystopian-thames':
        // Polluted industrial water - dark, oily surface, toxic sheen
        return { 
          color: '#0a1a2a', 
          transmission: 0.15, 
          roughness: 0.22, 
          thickness: 1.0,
          emissive: '#1a2a4a', 
          emissiveIntensity: 0.025,
          attenuationColor: '#0a1520',
          attenuationDistance: 1.0,
          specularIntensity: 1.4, // Oily sheen
          sheenColor: '#2a3a5a'
        };
      case 'scifi-boston':
        // Futuristic water with neon reflections - dark with luminous quality
        return { 
          color: '#0a3a4a', 
          transmission: 0.45, 
          roughness: 0.06, 
          thickness: 2.5,
          emissive: '#00ced1', 
          emissiveIntensity: 0.12,
          attenuationColor: '#006080',
          attenuationDistance: 5.0,
          specularIntensity: 1.0,
          sheenColor: '#40e0d0'
        };
      default: // Realistic contemporary river (Willowbrook)
        // Natural river water - balanced visibility, green-blue tones
        return { 
          color: '#3a5a55', 
          transmission: 0.38, 
          roughness: 0.10, 
          thickness: 2.5,
          emissive: '#2a4a40', 
          emissiveIntensity: 0.008,
          attenuationColor: '#2a4a45',
          attenuationDistance: 4.0,
          specularIntensity: 0.9,
          sheenColor: '#4a6a60'
        };
    }
  }, [theme]);
  
  // Attach GPU Gerstner wave shader whenever theme changes (requires material recompile).
  // Skipped in Playwright: shader recompilation after context-restore stalls the page.
  useEffect(() => {
    if (IS_TEST_MODE) return;
    const mat = materialRef.current;
    if (!mat) return;
    attachGerstnerShader(mat, timeUniformRef.current, 'z', theme);
    mat.needsUpdate = true;
  }, [theme]);

  // Update time uniform and material animation properties each frame
  useFrame((state) => {
    const time = state.clock.elapsedTime;
    timeUniformRef.current.value = time;

    if (materialRef.current) {
      // Dynamic roughness — wind-driven micro-ripples
      const windVariation = Math.sin(time * 0.3) * 0.015 + Math.sin(time * 0.7) * 0.008;
      materialRef.current.roughness = waterConfig.roughness + windVariation;

      // Subtle emissive pulsing simulating light caustics
      const causticPulse = (Math.sin(time * 1.2) * 0.5 + 0.5) * 0.02;
      materialRef.current.emissiveIntensity = waterConfig.emissiveIntensity + causticPulse;
    }
  });

  return (
    <>
      <mesh
        ref={meshRef}
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, -0.1, boatZ]}
        receiveShadow
      >
        {/* Tessellation keyed to performanceMode: 64×64 high-quality, 32×32 low-power */}
        <planeGeometry args={[1000, 1000, isHighQuality ? 64 : 32, isHighQuality ? 64 : 32]} />
        <meshPhysicalMaterial
          ref={materialRef}
          color={waterConfig.color}
          metalness={0.05}
          roughness={waterConfig.roughness}
          transmission={waterConfig.transmission}
          thickness={waterConfig.thickness}
          ior={1.333}
          reflectivity={0.95}
          clearcoat={0.4}
          clearcoatRoughness={0.25}
          envMapIntensity={2.2}
          transparent
          opacity={0.94}
          emissive={waterConfig.emissive}
          emissiveIntensity={waterConfig.emissiveIntensity}
          attenuationColor={waterConfig.attenuationColor}
          attenuationDistance={waterConfig.attenuationDistance}
          specularIntensity={waterConfig.specularIntensity}
          sheen={0.15}
          sheenColor={waterConfig.sheenColor}
          sheenRoughness={0.3}
          side={THREE.FrontSide}
        />
      </mesh>
      {!IS_TEST_MODE && (
        <WaterReflectionProbe materialRef={materialRef} meshRef={meshRef} />
      )}
    </>
  );
};

// ============================================================================
// HD MIST LAYER - Multi-layered volumetric fog for atmospheric depth
// ============================================================================
const MistLayer: React.FC<{ boatZ: number; theme: RouteTheme }> = ({ boatZ, theme }) => {
  const layer1Ref = useRef<THREE.Mesh>(null);
  const layer2Ref = useRef<THREE.Mesh>(null);
  
  // HD mist configuration with multiple layers
  const mistConfig = useMemo(() => {
    switch (theme) {
      case 'gothic-venice': 
        return { 
          baseOpacity: 0.22, 
          color1: '#1e272e', 
          color2: '#2a3a4a',
          height1: 0.6, 
          height2: 2.5,
          density: 1.4
        };
      case 'dystopian-thames': 
        return { 
          baseOpacity: 0.18, 
          color1: '#1a1a2e', 
          color2: '#2a2a3e',
          height1: 0.5, 
          height2: 3.0,
          density: 1.2
        };
      case 'steampunk-henley': 
        return { 
          baseOpacity: 0.14, 
          color1: '#8b7355', 
          color2: '#a08565',
          height1: 0.8, 
          height2: 2.0,
          density: 0.9
        };
      case 'crystal-bled': 
        return { 
          baseOpacity: 0.06, 
          color1: '#e8f4f8', 
          color2: '#d0e8f0',
          height1: 0.3, 
          height2: 1.5,
          density: 0.5
        };
      case 'scifi-boston': 
        return { 
          baseOpacity: 0.08, 
          color1: '#162447', 
          color2: '#1a3a5a',
          height1: 0.4, 
          height2: 2.0,
          density: 0.7
        };
      default: 
        return { 
          baseOpacity: 0.10, 
          color1: '#c8d4dc', 
          color2: '#d8e4ec',
          height1: 0.5, 
          height2: 1.8,
          density: 0.8
        };
    }
  }, [theme]);
  
  // Animate mist drift for realism
  useFrame((state) => {
    const time = state.clock.elapsedTime;
    if (layer1Ref.current) {
      layer1Ref.current.position.x = Math.sin(time * 0.05) * 3;
      layer1Ref.current.position.z = boatZ + Math.cos(time * 0.03) * 2;
    }
    if (layer2Ref.current) {
      layer2Ref.current.position.x = Math.sin(time * 0.04 + 1) * 5;
      layer2Ref.current.position.z = boatZ + Math.cos(time * 0.025 + 0.5) * 3;
    }
  });
  
  return (
    <group>
      {/* Ground-hugging mist layer */}
      <mesh ref={layer1Ref} position={[0, mistConfig.height1, boatZ]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[900, 900]} />
        <meshBasicMaterial
          color={mistConfig.color1}
          transparent
          opacity={mistConfig.baseOpacity * mistConfig.density}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>
      {/* Higher atmospheric haze layer */}
      <mesh ref={layer2Ref} position={[0, mistConfig.height2, boatZ]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[1200, 1200]} />
        <meshBasicMaterial
          color={mistConfig.color2}
          transparent
          opacity={mistConfig.baseOpacity * 0.4}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>
    </group>
  );
};

// ============================================================================
// HD CURVED WATER CHANNEL - Follows GPS path with realistic water rendering
// ============================================================================
interface CurvedWaterChannelProps {
  curve: THREE.CatmullRomCurve3 | null;
  theme: RouteTheme;
  isHighQuality: boolean;
}

const CurvedWaterChannel: React.FC<CurvedWaterChannelProps> = ({ curve, theme, isHighQuality }) => {
  const meshRef        = useRef<THREE.Mesh>(null);
  const materialRef    = useRef<THREE.MeshPhysicalMaterial>(null);
  const timeUniformRef = useRef({ value: 0 });
  
  // HD Theme-based water colors with enhanced realism (matches PhotorealisticWater)
  const waterConfig = useMemo(() => {
    switch (theme) {
      case 'crystal-bled':
        return { 
          color: '#3a9db8', 
          emissive: '#00e5ff', 
          emissiveIntensity: 0.06,
          transmission: 0.65,
          thickness: 3.5,
          attenuationColor: '#00a8cc',
          roughness: 0.04
        };
      case 'gothic-venice':
        return { 
          color: '#1e3a3a', 
          emissive: '#0a3d62', 
          emissiveIntensity: 0.015,
          transmission: 0.22,
          thickness: 1.5,
          attenuationColor: '#1a2f2f',
          roughness: 0.18
        };
      case 'steampunk-henley':
        return { 
          color: '#3a4a38', 
          emissive: '#4a6741', 
          emissiveIntensity: 0.008,
          transmission: 0.28,
          thickness: 2.0,
          attenuationColor: '#3a4a38',
          roughness: 0.15
        };
      case 'dystopian-thames':
        return { 
          color: '#0a1a2a', 
          emissive: '#1a2a4a', 
          emissiveIntensity: 0.025,
          transmission: 0.15,
          thickness: 1.0,
          attenuationColor: '#0a1520',
          roughness: 0.22
        };
      case 'scifi-boston':
        return { 
          color: '#0a3a4a', 
          emissive: '#00ced1', 
          emissiveIntensity: 0.12,
          transmission: 0.45,
          thickness: 2.5,
          attenuationColor: '#006080',
          roughness: 0.06
        };
      default:
        return { 
          color: '#3a5a55', 
          emissive: '#2a4a40', 
          emissiveIntensity: 0.008,
          transmission: 0.38,
          thickness: 2.5,
          attenuationColor: '#2a4a45',
          roughness: 0.10
        };
    }
  }, [theme]);
  
  // Attach GPU Gerstner wave shader when theme changes.
  // Skipped in Playwright: shader recompilation after context-restore stalls the page.
  useEffect(() => {
    if (IS_TEST_MODE) return;
    const mat = materialRef.current;
    if (!mat) return;
    // Curved channel geometry uses Y as height axis (no -PI/2 rotation)
    attachGerstnerShader(mat, timeUniformRef.current, 'y', `curved-${theme}`);
    mat.needsUpdate = true;
  }, [theme]);

  // Animate water material for dynamic surface
  useFrame((state) => {
    const time = state.clock.elapsedTime;
    timeUniformRef.current.value = time;
    if (materialRef.current) {
      const windVariation = Math.sin(time * 0.3) * 0.012 + Math.sin(time * 0.7) * 0.006;
      materialRef.current.roughness = waterConfig.roughness + windVariation;
    }
  });
  
  // Generate curved water geometry following the path
  const waterGeometry = useMemo(() => {
    if (!curve) return null;
    
    const segments = isHighQuality ? 200 : 100;
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
  }, [curve, isHighQuality]);
  
  if (!curve || !waterGeometry) {
    return null;
  }
  
  return (
    <mesh ref={meshRef} geometry={waterGeometry} receiveShadow>
      <meshPhysicalMaterial
        ref={materialRef}
        color={waterConfig.color}
        metalness={0.05}
        roughness={waterConfig.roughness}
        transmission={waterConfig.transmission}
        thickness={waterConfig.thickness}
        ior={1.333}
        reflectivity={0.95}
        clearcoat={0.4}
        clearcoatRoughness={0.25}
        envMapIntensity={1.8}
        transparent
        opacity={0.94}
        emissive={waterConfig.emissive}
        emissiveIntensity={waterConfig.emissiveIntensity}
        attenuationColor={waterConfig.attenuationColor}
        attenuationDistance={waterConfig.thickness * 1.5}
        side={THREE.FrontSide}
      />
    </mesh>
  );
};

// ============================================================================
// CURVED RIVERBANKS - Follow GPS path on both sides, outside water channel
// ============================================================================
// ============================================================================
// HD CURVED RIVERBANKS - Follows GPS path with realistic terrain materials
// ============================================================================
interface CurvedRiverbanksProps {
  curve: THREE.CatmullRomCurve3 | null;
  theme: RouteTheme;
}

const CurvedRiverbanks: React.FC<CurvedRiverbanksProps> = ({ curve, theme }) => {
  // HD Theme-based bank materials with realistic PBR properties
  const bankConfig = useMemo(() => {
    switch (theme) {
      case 'crystal-bled':
        // Alpine meadow - lush green grass with rocky edges
        return { 
          color: '#5a8a42', 
          roughness: 0.88,
          metalness: 0.0,
          emissive: '#2a4a22',
          emissiveIntensity: 0.01,
          sheen: 0.25,
          sheenColor: '#7ab05a'
        };
      case 'gothic-venice':
        // Weathered stone embankments with moss
        return { 
          color: '#2a3a2a', 
          roughness: 0.95,
          metalness: 0.02,
          emissive: '#1a2a1a',
          emissiveIntensity: 0.005,
          sheen: 0.1,
          sheenColor: '#3a4a3a'
        };
      case 'steampunk-henley':
        // Manicured grass with golden-brown edges
        return { 
          color: '#6a7a48', 
          roughness: 0.82,
          metalness: 0.0,
          emissive: '#4a5a30',
          emissiveIntensity: 0.008,
          sheen: 0.35,
          sheenColor: '#8a9a68'
        };
      case 'dystopian-thames':
        // Industrial concrete and muddy ground
        return { 
          color: '#1a1a18', 
          roughness: 0.96,
          metalness: 0.05,
          emissive: '#0a0a08',
          emissiveIntensity: 0.002,
          sheen: 0.05,
          sheenColor: '#2a2a28'
        };
      case 'scifi-boston':
        // High-tech walkway materials
        return { 
          color: '#1a2a3a', 
          roughness: 0.75,
          metalness: 0.15,
          emissive: '#0a1a2a',
          emissiveIntensity: 0.015,
          sheen: 0.2,
          sheenColor: '#2a4a5a'
        };
      default:
        // Natural river grass - Willowbrook
        return { 
          color: '#4a7a32', 
          roughness: 0.9,
          metalness: 0.0,
          emissive: '#2a4a18',
          emissiveIntensity: 0.006,
          sheen: 0.3,
          sheenColor: '#6a9a52'
        };
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

  // Dispose geometries when curve changes or component unmounts to prevent GPU memory leaks
  useEffect(() => {
    return () => {
      leftBankGeometry?.dispose();
      rightBankGeometry?.dispose();
    };
  }, [leftBankGeometry, rightBankGeometry]);
  
  if (!curve || !leftBankGeometry || !rightBankGeometry) {
    return null;
  }
  
  return (
    <group>
      <mesh geometry={leftBankGeometry} receiveShadow>
        <meshPhysicalMaterial 
          color={bankConfig.color} 
          roughness={bankConfig.roughness}
          metalness={bankConfig.metalness}
          emissive={bankConfig.emissive}
          emissiveIntensity={bankConfig.emissiveIntensity}
          sheen={bankConfig.sheen}
          sheenColor={bankConfig.sheenColor}
          sheenRoughness={0.8}
        />
      </mesh>
      <mesh geometry={rightBankGeometry} receiveShadow>
        <meshPhysicalMaterial 
          color={bankConfig.color} 
          roughness={bankConfig.roughness}
          metalness={bankConfig.metalness}
          emissive={bankConfig.emissive}
          emissiveIntensity={bankConfig.emissiveIntensity}
          sheen={bankConfig.sheen}
          sheenColor={bankConfig.sheenColor}
          sheenRoughness={0.8}
        />
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
    const minOffset = LANDSCAPE_OFFSET; // Minimum distance from water center
    
    let elemIdx = 0;
    for (let t = 0; t < 1; t += elementSpacing) {
      const point = curve.getPointAt(t);
      const tangent = curve.getTangentAt(t).normalize();
      const up = new THREE.Vector3(0, 1, 0);
      const perp = new THREE.Vector3().crossVectors(tangent, up).normalize();
      
      // Stable offset beyond the minimum landscape offset
      const leftOffset = minOffset + seededRandom(elemIdx * 7 + 1) * 30;
      const rightOffset = minOffset + seededRandom(elemIdx * 7 + 2) * 30;
      
      // Element type based on theme and stable seed
      const getElementType = (seedOffset: number): 'tree' | 'mountain' | 'building' => {
        const rand = seededRandom(elemIdx * 7 + seedOffset);
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
      if (seededRandom(elemIdx * 7 + 4) < 0.6) {
        const leftPos = new THREE.Vector3().copy(point).addScaledVector(perp, -leftOffset);
        leftPos.y = 0;
        leftElements.push({
          position: leftPos,
          type: getElementType(3),
          scale: 0.8 + seededRandom(elemIdx * 7 + 5) * 0.8,
          rotation: Math.atan2(tangent.x, tangent.z) + Math.PI / 2
        });
      }
      
      if (seededRandom(elemIdx * 7 + 6) < 0.6) {
        const rightPos = new THREE.Vector3().copy(point).addScaledVector(perp, rightOffset);
        rightPos.y = 0;
        rightElements.push({
          position: rightPos,
          type: getElementType(7),
          scale: 0.8 + seededRandom(elemIdx * 7 + 8) * 0.8,
          rotation: Math.atan2(tangent.x, tangent.z) - Math.PI / 2
        });
      }
      elemIdx++;
    }
    
    return { leftElements, rightElements };
  }, [curve, theme]);
  
  // Get HD theme colors for elements with enhanced detail
  const colors = useMemo(() => {
    switch (theme) {
      case 'crystal-bled':
        return { 
          tree: '#2a5a38', treeBark: '#4a3020', treeHighlight: '#4a8a58',
          mountain: '#5a7247', mountainSnow: '#f8faff', 
          building: '#8fa4b8', buildingAccent: '#6a8098', windowGlow: '#e8f4ff'
        };
      case 'gothic-venice':
        return { 
          tree: '#1a2818', treeBark: '#2a1810', treeHighlight: '#2a3a28',
          mountain: '#3d4a3a', mountainSnow: '#c0c8d0', 
          building: '#3a4552', buildingAccent: '#2a3542', windowGlow: '#ff8844'
        };
      case 'steampunk-henley':
        return { 
          tree: '#4a5a3a', treeBark: '#5a4030', treeHighlight: '#6a7a5a',
          mountain: '#8b7355', mountainSnow: '#e8dcd0', 
          building: '#c49a32', buildingAccent: '#8b6914', windowGlow: '#ffcc44'
        };
      case 'dystopian-thames':
        return { 
          tree: '#151512', treeBark: '#1a1510', treeHighlight: '#252520',
          mountain: '#2a2a2a', mountainSnow: '#4a4a4a', 
          building: '#3a3a3a', buildingAccent: '#2a2a2a', windowGlow: '#ff4422'
        };
      case 'scifi-boston':
        return { 
          tree: '#152a20', treeBark: '#1a2018', treeHighlight: '#2a4a3a',
          mountain: '#2a3a4a', mountainSnow: '#4a6a8a', 
          building: '#3a5a7a', buildingAccent: '#2a4a6a', windowGlow: '#00e0ff'
        };
      default:
        return { 
          tree: '#2a5a38', treeBark: '#4a3020', treeHighlight: '#4a8a58',
          mountain: '#5a7247', mountainSnow: '#f5f8fa', 
          building: '#8b7355', buildingAccent: '#6a5a45', windowGlow: '#ffcc88'
        };
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
          <group key={`${side}-tree-${index}`} position={[el.position.x, el.position.y, el.position.z]} rotation={[0, el.rotation, 0]}>
            {/* HD Photorealistic trunk with detailed bark texture simulation */}
            <mesh position={[0, 2 * el.scale, 0]} castShadow>
              <cylinderGeometry args={[0.22 * el.scale, 0.42 * el.scale, 4.2 * el.scale, 16]} />
              <meshPhysicalMaterial 
                color={colors.treeBark}
                roughness={0.96}
                metalness={0.0}
                clearcoat={0.02}
                clearcoatRoughness={0.98}
                sheen={0.05}
                sheenColor="#2a1a10"
              />
            </mesh>
            {/* Detailed root flare with organic shape */}
            <mesh position={[0, 0.15 * el.scale, 0]} castShadow>
              <cylinderGeometry args={[0.38 * el.scale, 0.65 * el.scale, 0.45 * el.scale, 10]} />
              <meshPhysicalMaterial 
                color={colors.treeBark}
                roughness={0.97}
                metalness={0.0}
                sheen={0.03}
                sheenColor="#1a1008"
              />
            </mesh>
            {/* Secondary roots spreading */}
            {[0, 1.2, 2.4, 3.6, 4.8].map((angle, j) => (
              <mesh key={j} position={[Math.cos(angle) * 0.5 * el.scale, 0.05, Math.sin(angle) * 0.5 * el.scale]} rotation={[0.3, angle, 0.4]} castShadow>
                <cylinderGeometry args={[0.06 * el.scale, 0.1 * el.scale, 0.6 * el.scale, 6]} />
                <meshPhysicalMaterial color={colors.treeBark} roughness={0.98} />
              </mesh>
            ))}
            {/* HD Multi-layer conifer foliage with realistic light transmission */}
            <mesh position={[0, 4.2 * el.scale, 0]} castShadow>
              <coneGeometry args={[2.8 * el.scale, 4.8 * el.scale, 16]} />
              <meshPhysicalMaterial 
                color={colors.tree}
                roughness={0.78}
                metalness={0.0}
                transmission={0.08}
                thickness={0.6}
                sheen={0.45}
                sheenColor={colors.treeHighlight}
                sheenRoughness={0.7}
              />
            </mesh>
            <mesh position={[0, 5.8 * el.scale, 0]} castShadow>
              <coneGeometry args={[2.1 * el.scale, 3.8 * el.scale, 16]} />
              <meshPhysicalMaterial 
                color={colors.tree}
                roughness={0.74}
                metalness={0.0}
                transmission={0.10}
                thickness={0.5}
                sheen={0.52}
                sheenColor={colors.treeHighlight}
                sheenRoughness={0.65}
              />
            </mesh>
            <mesh position={[0, 7.0 * el.scale, 0]} castShadow>
              <coneGeometry args={[1.4 * el.scale, 3.0 * el.scale, 14]} />
              <meshPhysicalMaterial 
                color={colors.tree}
                roughness={0.70}
                metalness={0.0}
                transmission={0.12}
                thickness={0.4}
                sheen={0.58}
                sheenColor={colors.treeHighlight}
                sheenRoughness={0.6}
              />
            </mesh>
            {/* Spire top */}
            <mesh position={[0, 8.0 * el.scale, 0]} castShadow>
              <coneGeometry args={[0.6 * el.scale, 2.0 * el.scale, 12]} />
              <meshPhysicalMaterial 
                color={colors.tree}
                roughness={0.68}
                transmission={0.14}
                thickness={0.3}
                sheen={0.65}
                sheenColor={colors.treeHighlight}
              />
            </mesh>
          </group>
        );
      case 'mountain':
        return (
          <group key={`${side}-mountain-${index}`} position={[el.position.x, 0, el.position.z]}>
            {/* HD Main mountain with realistic rock surfaces */}
            <mesh position={[0, 8 * el.scale, 0]} castShadow receiveShadow>
              <coneGeometry args={[10 * el.scale, 20 * el.scale, 10]} />
              <meshPhysicalMaterial 
                color={colors.mountain}
                roughness={0.94}
                metalness={0.03}
                clearcoat={0.015}
                clearcoatRoughness={0.96}
                sheen={0.05}
                sheenColor="#4a5540"
              />
            </mesh>
            {/* HD Snow cap with realistic ice/snow material */}
            <mesh position={[0, 14 * el.scale, 0]} castShadow>
              <coneGeometry args={[4.2 * el.scale, 8.5 * el.scale, 10]} />
              <meshPhysicalMaterial 
                color={colors.mountainSnow}
                roughness={0.32}
                metalness={0.0}
                clearcoat={0.42}
                clearcoatRoughness={0.48}
                sheen={0.9}
                sheenColor="#d8e8f8"
                sheenRoughness={0.4}
              />
            </mesh>
            {/* Multiple rocky outcrops for natural appearance */}
            <mesh position={[3 * el.scale, 5 * el.scale, 2 * el.scale]} castShadow>
              <dodecahedronGeometry args={[1.6 * el.scale, 0]} />
              <meshPhysicalMaterial color="#4a5545" roughness={0.95} metalness={0.02} />
            </mesh>
            <mesh position={[-2 * el.scale, 7 * el.scale, 3 * el.scale]} castShadow>
              <dodecahedronGeometry args={[1.2 * el.scale, 0]} />
              <meshPhysicalMaterial color="#525a4a" roughness={0.94} metalness={0.02} />
            </mesh>
            <mesh position={[1 * el.scale, 4 * el.scale, -2.5 * el.scale]} castShadow>
              <dodecahedronGeometry args={[1.8 * el.scale, 0]} />
              <meshPhysicalMaterial color="#4a5040" roughness={0.96} metalness={0.01} />
            </mesh>
          </group>
        );
      case 'building':
        return (
          <group 
            key={`${side}-building-${index}`} 
            position={[el.position.x, 0, el.position.z]} 
            rotation={[0, el.rotation, 0]}
          >
            {/* HD Main building with detailed architectural materials */}
            <mesh position={[0, 6 * el.scale, 0]} castShadow receiveShadow>
              <boxGeometry args={[4.2 * el.scale, 12.5 * el.scale, 4.2 * el.scale]} />
              <meshPhysicalMaterial 
                color={colors.building}
                roughness={0.72}
                metalness={0.08}
                clearcoat={0.12}
                clearcoatRoughness={0.75}
                sheen={0.1}
                sheenColor={colors.buildingAccent}
              />
            </mesh>
            {/* Detailed roof with cornices */}
            <mesh position={[0, 12.5 * el.scale, 0]} castShadow>
              <boxGeometry args={[4.5 * el.scale, 0.5 * el.scale, 4.5 * el.scale]} />
              <meshPhysicalMaterial 
                color={colors.buildingAccent}
                roughness={0.78}
                metalness={0.12}
                clearcoat={0.08}
              />
            </mesh>
            {/* Secondary roof detail */}
            <mesh position={[0, 12.8 * el.scale, 0]} castShadow>
              <boxGeometry args={[3.8 * el.scale, 0.3 * el.scale, 3.8 * el.scale]} />
              <meshPhysicalMaterial color="#2a2a2a" roughness={0.88} metalness={0.1} />
            </mesh>
            {/* HD Windows with realistic glass reflections and interior glow */}
            {[0.22, 0.42, 0.62, 0.82].map((yPos, j) => (
              <React.Fragment key={j}>
                {/* Front windows */}
                <mesh position={[2.12 * el.scale, 12 * el.scale * yPos, 0]} castShadow>
                  <boxGeometry args={[0.06 * el.scale, 1.3 * el.scale, 2.6 * el.scale]} />
                  <meshPhysicalMaterial 
                    color="#0a1a2a"
                    roughness={0.04}
                    metalness={0.98}
                    reflectivity={1.0}
                    clearcoat={1.0}
                    clearcoatRoughness={0.01}
                    emissive={colors.windowGlow}
                    emissiveIntensity={seededRandom(index * 17 + j) > 0.5 ? 0.35 : 0.08}
                    ior={1.5}
                  />
                </mesh>
                {/* Back windows */}
                <mesh position={[-2.12 * el.scale, 12 * el.scale * yPos, 0]} castShadow>
                  <boxGeometry args={[0.06 * el.scale, 1.3 * el.scale, 2.6 * el.scale]} />
                  <meshPhysicalMaterial 
                    color="#0a1a2a"
                    roughness={0.04}
                    metalness={0.98}
                    reflectivity={1.0}
                    clearcoat={1.0}
                    clearcoatRoughness={0.01}
                    emissive={colors.windowGlow}
                    emissiveIntensity={seededRandom(index * 17 + j + 4) > 0.6 ? 0.3 : 0.06}
                    ior={1.5}
                  />
                </mesh>
              </React.Fragment>
            ))}
            {/* Window frames for detail */}
            <mesh position={[2.14 * el.scale, 6 * el.scale, 0]} castShadow>
              <boxGeometry args={[0.02 * el.scale, 10 * el.scale, 2.8 * el.scale]} />
              <meshPhysicalMaterial color="#1a1a1a" roughness={0.9} metalness={0.15} />
            </mesh>
          </group>
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
// PROCEDURAL TERRAIN - Mountains along the banks
// ============================================================================
const ProceduralTerrain: React.FC<{ side: 'left' | 'right'; boatZ: number }> = ({ side, boatZ }) => {
  const xOffset = side === 'left' ? -35 : 35;
  
  // Generate mountain positions along the route with more detail
  const mountains = useMemo(() => {
    const result: Array<{ x: number; z: number; scale: number; height: number; snowLine: number; rockVariant: number }> = [];
    for (let z = -500; z < 500; z += 40) {
      const i = Math.round((z + 500) / 40);
      const height = 15 + seededRandom(i * 11 + 1) * 25;
      result.push({
        x: xOffset + (seededRandom(i * 11 + 2) - 0.5) * 10,
        z: z + (seededRandom(i * 11 + 3) - 0.5) * 20,
        scale: 8 + seededRandom(i * 11 + 4) * 12,
        height,
        snowLine: 0.6 + seededRandom(i * 11 + 5) * 0.2,
        rockVariant: Math.floor(seededRandom(i * 11 + 6) * 3),
      });
    }
    return result;
  }, [xOffset]);
  
  // Rock color variations for natural appearance
  const rockColors = ['#5a6350', '#6b7260', '#4a5540', '#5e6955'];
  
  return (
    <group position={[0, 0, boatZ]}>
      {mountains.map((m, i) => (
        <group key={i} position={[m.x, 0, m.z]}>
          {/* Main mountain body with realistic rock material */}
          <mesh position={[0, m.height / 2 - 2, 0]} castShadow receiveShadow>
            <coneGeometry args={[m.scale, m.height, 8]} />
            <meshPhysicalMaterial 
              color={rockColors[m.rockVariant]}
              roughness={0.92}
              metalness={0.05}
              clearcoat={0.02}
              clearcoatRoughness={0.95}
            />
          </mesh>
          
          {/* Rocky outcrops for detail */}
          <mesh position={[m.scale * 0.3, m.height * 0.25, m.scale * 0.2]} castShadow>
            <dodecahedronGeometry args={[m.scale * 0.15, 0]} />
            <meshPhysicalMaterial 
              color="#4a5545"
              roughness={0.95}
              metalness={0.02}
            />
          </mesh>
          <mesh position={[-m.scale * 0.25, m.height * 0.35, -m.scale * 0.15]} castShadow>
            <dodecahedronGeometry args={[m.scale * 0.12, 0]} />
            <meshPhysicalMaterial 
              color="#555f50"
              roughness={0.93}
              metalness={0.03}
            />
          </mesh>
          
          {/* Snow cap with realistic material */}
          <mesh position={[0, m.height * m.snowLine, 0]} castShadow>
            <coneGeometry args={[m.scale * (1 - m.snowLine) * 1.1, m.height * (1 - m.snowLine) * 1.2, 8]} />
            <meshPhysicalMaterial 
              color="#f8fafc"
              roughness={0.4}
              metalness={0.0}
              clearcoat={0.3}
              clearcoatRoughness={0.6}
              sheen={0.8}
              sheenColor="#e8f0ff"
            />
          </mesh>
          
          {/* Snow detail patches */}
          <mesh position={[m.scale * 0.2, m.height * (m.snowLine - 0.1), m.scale * 0.1]} castShadow>
            <sphereGeometry args={[m.scale * 0.08, 8, 6]} />
            <meshPhysicalMaterial 
              color="#ffffff"
              roughness={0.35}
              clearcoat={0.4}
              sheenColor="#e0e8ff"
              sheen={0.7}
            />
          </mesh>
          
          {/* Treeline at base */}
          {[0, 1, 2].map((j) => (
            <mesh 
              key={`tree-${j}`}
              position={[
                m.scale * 0.6 * Math.cos((j / 3) * Math.PI * 2),
                1.5,
                m.scale * 0.6 * Math.sin((j / 3) * Math.PI * 2)
              ]} 
              castShadow
            >
              <coneGeometry args={[1.5, 4, 8]} />
              <meshPhysicalMaterial 
                color="#2a4a2a"
                roughness={0.85}
                sheen={0.3}
                sheenColor="#3a5a3a"
              />
            </mesh>
          ))}
        </group>
      ))}
    </group>
  );
};

// ============================================================================
// PINE TREES - Scattered along the banks
// ============================================================================
const PineTrees: React.FC<{ side: 'left' | 'right'; boatZ: number }> = ({ side, boatZ }) => {
  const xBase = side === 'left' ? -25 : 25;
  
  // Generate tree positions with variety
  const trees = useMemo(() => {
    const result: Array<{ x: number; z: number; scale: number; variant: number; rotation: number }> = [];
    for (let z = -400; z < 400; z += 8) {
      const treeIdx = Math.round((z + 400) / 8);
      const count = 1 + Math.floor(seededRandom(treeIdx * 9 + 1) * 2);
      for (let j = 0; j < count; j++) {
        result.push({
          x: xBase + (seededRandom(treeIdx * 9 + j * 4 + 2) - 0.5) * 15 + (side === 'left' ? -5 : 5),
          z: z + (seededRandom(treeIdx * 9 + j * 4 + 3) - 0.5) * 6,
          scale: 0.8 + seededRandom(treeIdx * 9 + j * 4 + 4) * 0.6,
          variant: Math.floor(seededRandom(treeIdx * 9 + j * 4 + 5) * 3),
          rotation: seededRandom(treeIdx * 9 + j * 4 + 6) * Math.PI * 2,
        });
      }
    }
    return result;
  }, [xBase, side]);
  
  return (
    <group position={[0, 0, boatZ]}>
      {trees.map((tree, i) => (
        <group key={i} position={[tree.x, 0, tree.z]} scale={tree.scale} rotation={[0, tree.rotation, 0]}>
          {/* Photorealistic tree trunk with bark texture simulation */}
          <mesh position={[0, 1.2, 0]} castShadow>
            <cylinderGeometry args={[0.12, 0.22, 2.4, 12]} />
            <meshPhysicalMaterial 
              color="#3d2817"
              roughness={0.95}
              metalness={0.0}
              clearcoat={0.05}
              clearcoatRoughness={0.9}
            />
          </mesh>
          {/* Bark detail rings */}
          {[0.4, 0.8, 1.2, 1.6].map((y, j) => (
            <mesh key={j} position={[0, y, 0]} castShadow>
              <torusGeometry args={[0.16 + (2.4 - y) * 0.02, 0.02, 6, 12]} />
              <meshStandardMaterial color="#2a1a0f" roughness={1.0} />
            </mesh>
          ))}
          {/* Root flare at base */}
          <mesh position={[0, 0.1, 0]} castShadow>
            <cylinderGeometry args={[0.22, 0.35, 0.3, 8]} />
            <meshPhysicalMaterial color="#3d2817" roughness={0.95} />
          </mesh>
          
          {/* Multi-layered foliage with subsurface scattering effect */}
          {/* Bottom layer - dense, darker */}
          <mesh position={[0, 2.8, 0]} castShadow>
            <coneGeometry args={[1.4, 2.2, 12]} />
            <meshPhysicalMaterial 
              color="#1a4020"
              roughness={0.85}
              metalness={0.0}
              transmission={0.05}
              thickness={0.5}
              sheen={0.3}
              sheenColor="#2a5030"
            />
          </mesh>
          {/* Middle layer */}
          <mesh position={[0, 3.8, 0]} castShadow>
            <coneGeometry args={[1.1, 2.0, 12]} />
            <meshPhysicalMaterial 
              color="#2a5a30"
              roughness={0.8}
              metalness={0.0}
              transmission={0.08}
              thickness={0.4}
              sheen={0.4}
              sheenColor="#3a7040"
            />
          </mesh>
          {/* Upper layer - lighter, catches more light */}
          <mesh position={[0, 4.6, 0]} castShadow>
            <coneGeometry args={[0.8, 1.8, 12]} />
            <meshPhysicalMaterial 
              color="#3a6a38"
              roughness={0.75}
              metalness={0.0}
              transmission={0.1}
              thickness={0.3}
              sheen={0.5}
              sheenColor="#4a8048"
            />
          </mesh>
          {/* Top spike */}
          <mesh position={[0, 5.3, 0]} castShadow>
            <coneGeometry args={[0.4, 1.2, 10]} />
            <meshPhysicalMaterial 
              color="#4a7a42"
              roughness={0.7}
              transmission={0.12}
              thickness={0.2}
              sheen={0.6}
              sheenColor="#5a9050"
            />
          </mesh>
          
          {/* Small branch details */}
          {tree.variant === 0 && (
            <>
              <mesh position={[0.3, 2.5, 0.2]} rotation={[0, 0, 0.4]} castShadow>
                <cylinderGeometry args={[0.03, 0.05, 0.6, 6]} />
                <meshStandardMaterial color="#3d2817" roughness={0.9} />
              </mesh>
              <mesh position={[-0.25, 2.8, -0.15]} rotation={[0, 0, -0.3]} castShadow>
                <cylinderGeometry args={[0.025, 0.04, 0.5, 6]} />
                <meshStandardMaterial color="#3d2817" roughness={0.9} />
              </mesh>
            </>
          )}
        </group>
      ))}
    </group>
  );
};

// ============================================================================
// THEMED LANDSCAPE COMPONENTS - Replace generic scenery for fantasy routes
// ============================================================================

// CRYSTAL BLED - Ethereal floating crystal towers with photorealistic refraction and glow
const CrystalBledLandscape: React.FC<{ side: 'left' | 'right'; boatZ: number }> = ({ side, boatZ }) => {
  const xOffset = side === 'left' ? -40 : 40;
  
  const crystals = useMemo(() => {
    const result: Array<{ x: number; z: number; height: number; radius: number; color: string; facets: number }> = [];
    const colors = ['#00f5d4', '#7df9ff', '#a0e7e5', '#40e0d0', '#00ced1'];
    for (let z = -500; z < 500; z += 30) {
      const i = Math.round((z + 500) / 30);
      result.push({
        x: xOffset + (seededRandom(i * 13 + 1) - 0.5) * 20,
        z: z + (seededRandom(i * 13 + 2) - 0.5) * 15,
        height: 12 + seededRandom(i * 13 + 3) * 25,
        radius: 1.5 + seededRandom(i * 13 + 4) * 2,
        color: colors[Math.floor(seededRandom(i * 13 + 5) * colors.length)],
        facets: 5 + Math.floor(seededRandom(i * 13 + 6) * 3),
      });
    }
    return result;
  }, [xOffset]);
  
  const mountains = useMemo(() => {
    const result: Array<{ x: number; z: number; scale: number; height: number; snowAmount: number }> = [];
    for (let z = -500; z < 500; z += 80) {
      const i = Math.round((z + 500) / 80);
      result.push({
        x: xOffset + (side === 'left' ? -30 : 30) + (seededRandom(i * 17 + 1) - 0.5) * 15,
        z: z + (seededRandom(i * 17 + 2) - 0.5) * 30,
        scale: 20 + seededRandom(i * 17 + 3) * 20,
        height: 30 + seededRandom(i * 17 + 4) * 40,
        snowAmount: 0.55 + seededRandom(i * 17 + 5) * 0.2,
      });
    }
    return result;
  }, [xOffset, side]);
  
  return (
    <group position={[0, 0, boatZ]}>
      {/* Photorealistic crystal spires */}
      {crystals.map((c, i) => (
        <group key={i} position={[c.x, 0, c.z]}>
          {/* Main crystal with realistic glass/gem material */}
          <mesh position={[0, c.height / 2, 0]} castShadow>
            <cylinderGeometry args={[c.radius * 0.25, c.radius, c.height, c.facets]} />
            <meshPhysicalMaterial 
              color={c.color}
              transparent 
              opacity={0.75}
              transmission={0.6}
              thickness={2.0}
              roughness={0.05}
              metalness={0.0}
              ior={2.4}
              reflectivity={1.0}
              clearcoat={1.0}
              clearcoatRoughness={0.02}
              emissive={c.color}
              emissiveIntensity={0.25}
              iridescence={0.3}
              iridescenceIOR={1.3}
            />
          </mesh>
          {/* Inner crystal core for depth */}
          <mesh position={[0, c.height / 2, 0]} castShadow>
            <cylinderGeometry args={[c.radius * 0.15, c.radius * 0.6, c.height * 0.8, c.facets]} />
            <meshPhysicalMaterial 
              color="#ffffff"
              transparent 
              opacity={0.4}
              transmission={0.8}
              thickness={1.0}
              roughness={0.02}
              emissive={c.color}
              emissiveIntensity={0.4}
            />
          </mesh>
          {/* Glow base with realistic emission */}
          <mesh position={[0, 0.4, 0]}>
            <cylinderGeometry args={[c.radius * 1.1, c.radius * 1.4, 0.8, 12]} />
            <meshPhysicalMaterial 
              color={c.color}
              transparent 
              opacity={0.35}
              emissive={c.color}
              emissiveIntensity={0.6}
              roughness={0.3}
            />
          </mesh>
          {/* Light pool on ground */}
          <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <circleGeometry args={[c.radius * 2, 16]} />
            <meshPhysicalMaterial 
              color={c.color}
              transparent 
              opacity={0.2}
              emissive={c.color}
              emissiveIntensity={0.3}
            />
          </mesh>
        </group>
      ))}
      {/* Photorealistic snow-capped mountains */}
      {mountains.map((m, i) => (
        <group key={`mtn-${i}`} position={[m.x, 0, m.z]}>
          {/* Main mountain with realistic rock */}
          <mesh position={[0, m.height / 2 - 2, 0]} castShadow receiveShadow>
            <coneGeometry args={[m.scale, m.height, 8]} />
            <meshPhysicalMaterial 
              color="#5a6570"
              roughness={0.92}
              metalness={0.05}
              clearcoat={0.03}
              clearcoatRoughness={0.9}
            />
          </mesh>
          {/* Rocky details */}
          <mesh position={[m.scale * 0.35, m.height * 0.3, m.scale * 0.2]} castShadow>
            <dodecahedronGeometry args={[m.scale * 0.12, 0]} />
            <meshPhysicalMaterial color="#4a5560" roughness={0.94} />
          </mesh>
          {/* Realistic snow cap */}
          <mesh position={[0, m.height * m.snowAmount, 0]} castShadow>
            <coneGeometry args={[m.scale * (1 - m.snowAmount) * 1.15, m.height * (1 - m.snowAmount) * 1.25, 8]} />
            <meshPhysicalMaterial 
              color="#f8fafc"
              roughness={0.35}
              metalness={0.0}
              clearcoat={0.4}
              clearcoatRoughness={0.5}
              sheen={0.9}
              sheenColor="#e8f4ff"
            />
          </mesh>
          {/* Snow patches */}
          <mesh position={[m.scale * 0.25, m.height * (m.snowAmount - 0.12), m.scale * 0.15]} castShadow>
            <sphereGeometry args={[m.scale * 0.1, 8, 6]} />
            <meshPhysicalMaterial color="#ffffff" roughness={0.32} sheen={0.85} sheenColor="#e0e8ff" />
          </mesh>
        </group>
      ))}
    </group>
  );
};

// GOTHIC VENICE - Ruined palaces with photorealistic weathered stone and reflective windows
const GothicVeniceLandscape: React.FC<{ side: 'left' | 'right'; boatZ: number }> = ({ side, boatZ }) => {
  const xOffset = side === 'left' ? -25 : 25;
  
  const buildings = useMemo(() => {
    const result: Array<{ x: number; z: number; height: number; width: number; depth: number; color: string; tilt: number; windowGlow: number; debrisOffset: number }> = [];
    const colors = ['#2d3436', '#1e272e', '#2c3e50', '#34495e', '#192a56'];
    for (let z = -400; z < 400; z += 20) {
      const i = Math.round((z + 400) / 20);
      result.push({
        x: xOffset + (seededRandom(i * 19 + 1) - 0.5) * 12,
        z: z + (seededRandom(i * 19 + 2) - 0.5) * 10,
        height: 8 + seededRandom(i * 19 + 3) * 14,
        width: 4 + seededRandom(i * 19 + 4) * 6,
        depth: 4 + seededRandom(i * 19 + 5) * 5,
        color: colors[Math.floor(seededRandom(i * 19 + 6) * colors.length)],
        tilt: (seededRandom(i * 19 + 7) - 0.5) * 0.15,
        windowGlow: seededRandom(i * 19 + 8),
        debrisOffset: (seededRandom(i * 19 + 9) - 0.5),
      });
    }
    return result;
  }, [xOffset]);
  
  return (
    <group position={[0, 0, boatZ]}>
      {buildings.map((b, i) => (
        <group key={i} position={[b.x, 0, b.z]} rotation={[0, 0, b.tilt]}>
          {/* Ruined palazzo with weathered stone material */}
          <mesh position={[0, b.height / 2, 0]} castShadow receiveShadow>
            <boxGeometry args={[b.width, b.height, b.depth]} />
            <meshPhysicalMaterial 
              color={b.color}
              roughness={0.92}
              metalness={0.02}
              clearcoat={0.05}
              clearcoatRoughness={0.9}
            />
          </mesh>
          
          {/* Architectural details - cornices */}
          <mesh position={[0, b.height * 0.95, 0]} castShadow>
            <boxGeometry args={[b.width + 0.3, 0.4, b.depth + 0.3]} />
            <meshPhysicalMaterial color="#3d4a50" roughness={0.88} metalness={0.03} />
          </mesh>
          <mesh position={[0, b.height * 0.6, 0]} castShadow>
            <boxGeometry args={[b.width + 0.15, 0.2, b.depth + 0.15]} />
            <meshPhysicalMaterial color="#3d4a50" roughness={0.9} />
          </mesh>
          
          {/* Gothic window arches with glass reflections */}
          {[0.25, 0.45, 0.65, 0.85].map((yPos, j) => (
            <group key={j}>
              {/* Window frame */}
              <mesh position={[b.width / 2 + 0.02, b.height * yPos, 0]}>
                <boxGeometry args={[0.08, 1.8, b.depth * 0.5]} />
                <meshPhysicalMaterial color="#1a1a2e" roughness={0.7} metalness={0.1} />
              </mesh>
              {/* Glass pane with reflections */}
              <mesh position={[b.width / 2 + 0.06, b.height * yPos, 0]}>
                <boxGeometry args={[0.02, 1.6, b.depth * 0.45]} />
                <meshPhysicalMaterial 
                  color="#0a2040"
                  roughness={0.1}
                  metalness={0.9}
                  reflectivity={1.0}
                  clearcoat={1.0}
                  clearcoatRoughness={0.05}
                  emissive={b.windowGlow > 0.7 ? "#ff9500" : "#0a2a4a"}
                  emissiveIntensity={b.windowGlow > 0.7 ? 0.4 : 0.15}
                  transparent
                  opacity={0.85}
                />
              </mesh>
              {/* Pointed arch top */}
              <mesh position={[b.width / 2 + 0.02, b.height * yPos + 1.0, 0]} rotation={[0, 0, Math.PI / 4]}>
                <boxGeometry args={[0.3, 0.3, 0.08]} />
                <meshPhysicalMaterial color="#1a1a2e" roughness={0.75} />
              </mesh>
            </group>
          ))}
          
          {/* Weathering and moss details */}
          <mesh position={[0, 0.5, b.depth / 2 + 0.01]}>
            <boxGeometry args={[b.width * 0.8, 1.5, 0.05]} />
            <meshPhysicalMaterial 
              color="#2a3a2a"
              roughness={0.95}
              transparent
              opacity={0.6}
            />
          </mesh>
          
          {/* Crumbling top with detailed debris */}
          <mesh position={[b.debrisOffset * b.width * 0.3, b.height + 0.5, 0]} castShadow>
            <boxGeometry args={[b.width * 0.4, 1.2, b.depth * 0.4]} />
            <meshPhysicalMaterial color={b.color} roughness={0.95} />
          </mesh>
          {/* Fallen debris */}
          <mesh position={[b.width * 0.4, 0.3, b.depth * 0.3]} rotation={[0.2, 0.5, 0.1]}>
            <boxGeometry args={[0.8, 0.5, 0.6]} />
            <meshPhysicalMaterial color="#3d4550" roughness={0.92} />
          </mesh>
        </group>
      ))}
    </group>
  );
};

// STEAMPUNK HENLEY - Brass towers with photorealistic metallic materials
const SteampunkHenleyLandscape: React.FC<{ side: 'left' | 'right'; boatZ: number }> = ({ side, boatZ }) => {
  const xOffset = side === 'left' ? -30 : 30;
  
  const structures = useMemo(() => {
    const result: Array<{ x: number; z: number; height: number; type: 'tower' | 'platform' | 'gear'; patina: number }> = [];
    for (let z = -400; z < 400; z += 25) {
      const i = Math.round((z + 400) / 25);
      const r1 = seededRandom(i * 29 + 1);
      const type = r1 > 0.6 ? 'tower' : (seededRandom(i * 29 + 2) > 0.5 ? 'platform' : 'gear');
      result.push({
        x: xOffset + (seededRandom(i * 29 + 3) - 0.5) * 15,
        z: z + (seededRandom(i * 29 + 4) - 0.5) * 12,
        height: 8 + seededRandom(i * 29 + 5) * 18,
        type,
        patina: seededRandom(i * 29 + 6),
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
              {/* Photorealistic brass tower */}
              <mesh position={[0, s.height / 2, 0]} castShadow receiveShadow>
                <cylinderGeometry args={[1.8, 2.8, s.height, 12]} />
                <meshPhysicalMaterial 
                  color="#b87333"
                  metalness={0.85}
                  roughness={0.25}
                  clearcoat={0.4}
                  clearcoatRoughness={0.3}
                  reflectivity={0.9}
                  envMapIntensity={1.2}
                />
              </mesh>
              {/* Decorative brass bands */}
              {[0.25, 0.5, 0.75].map((yPos, j) => (
                <mesh key={j} position={[0, s.height * yPos, 0]}>
                  <torusGeometry args={[2.2, 0.15, 8, 24]} />
                  <meshPhysicalMaterial 
                    color="#daa520"
                    metalness={0.9}
                    roughness={0.2}
                    clearcoat={0.5}
                  />
                </mesh>
              ))}
              {/* Copper dome with verdigris */}
              <mesh position={[0, s.height + 1.2, 0]}>
                <sphereGeometry args={[2.6, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
                <meshPhysicalMaterial 
                  color={s.patina > 0.5 ? "#4a8066" : "#cd7f32"}
                  metalness={0.8}
                  roughness={s.patina > 0.5 ? 0.5 : 0.25}
                  clearcoat={0.3}
                  clearcoatRoughness={0.4}
                />
              </mesh>
              {/* Steam vent with metallic finish */}
              <mesh position={[0, s.height + 3, 0]}>
                <cylinderGeometry args={[0.25, 0.45, 2, 8]} />
                <meshPhysicalMaterial 
                  color="#8b7355"
                  metalness={0.7}
                  roughness={0.4}
                  clearcoat={0.2}
                />
              </mesh>
              {/* Steam effect (subtle glow) */}
              <mesh position={[0, s.height + 4.2, 0]}>
                <sphereGeometry args={[0.6, 8, 8]} />
                <meshPhysicalMaterial 
                  color="#ffffff"
                  transparent
                  opacity={0.25}
                  emissive="#ffffff"
                  emissiveIntensity={0.15}
                />
              </mesh>
            </>
          )}
          {s.type === 'platform' && (
            <>
              {/* Iron platform with realistic weathered metal */}
              <mesh position={[0, s.height * 0.3, 0]} castShadow receiveShadow>
                <boxGeometry args={[8, 0.8, 6]} />
                <meshPhysicalMaterial 
                  color="#5a4a40"
                  metalness={0.6}
                  roughness={0.55}
                  clearcoat={0.15}
                  clearcoatRoughness={0.7}
                />
              </mesh>
              {/* Riveted edge details */}
              <mesh position={[0, s.height * 0.3 + 0.5, 0]}>
                <boxGeometry args={[8.2, 0.15, 6.2]} />
                <meshPhysicalMaterial color="#4a3a30" metalness={0.65} roughness={0.5} />
              </mesh>
              {/* Support legs with realistic iron */}
              {[[-3, -2], [-3, 2], [3, -2], [3, 2]].map(([x, z], j) => (
                <mesh key={j} position={[x, s.height * 0.15, z]}>
                  <cylinderGeometry args={[0.25, 0.35, s.height * 0.3, 8]} />
                  <meshPhysicalMaterial 
                    color="#4a3a30"
                    metalness={0.55}
                    roughness={0.6}
                    clearcoat={0.1}
                  />
                </mesh>
              ))}
              {/* Cross-bracing */}
              <mesh position={[-3, s.height * 0.15, 0]} rotation={[0, 0, 0.3]}>
                <cylinderGeometry args={[0.08, 0.08, 5, 6]} />
                <meshPhysicalMaterial color="#3a2a20" metalness={0.5} roughness={0.65} />
              </mesh>
              <mesh position={[3, s.height * 0.15, 0]} rotation={[0, 0, -0.3]}>
                <cylinderGeometry args={[0.08, 0.08, 5, 6]} />
                <meshPhysicalMaterial color="#3a2a20" metalness={0.5} roughness={0.65} />
              </mesh>
            </>
          )}
          {s.type === 'gear' && (
            <>
              {/* Giant gear with photorealistic gold/brass */}
              <mesh position={[0, s.height * 0.4, 0]} rotation={[Math.PI / 2, 0, 0]}>
                <torusGeometry args={[4, 0.7, 12, 20]} />
                <meshPhysicalMaterial 
                  color="#daa520"
                  metalness={0.9}
                  roughness={0.18}
                  clearcoat={0.5}
                  clearcoatRoughness={0.25}
                  reflectivity={1.0}
                  envMapIntensity={1.3}
                />
              </mesh>
              {/* Gear teeth (simplified) */}
              {[...Array(12)].map((_, j) => {
                const angle = (j / 12) * Math.PI * 2;
                return (
                  <mesh 
                    key={j} 
                    position={[
                      Math.cos(angle) * 4.6,
                      s.height * 0.4,
                      Math.sin(angle) * 4.6
                    ]}
                    rotation={[Math.PI / 2, 0, angle]}
                  >
                    <boxGeometry args={[0.8, 0.6, 0.7]} />
                    <meshPhysicalMaterial 
                      color="#c9a520"
                      metalness={0.88}
                      roughness={0.22}
                      clearcoat={0.4}
                    />
                  </mesh>
                );
              })}
              {/* Gear center hub */}
              <mesh position={[0, s.height * 0.4, 0]} rotation={[Math.PI / 2, 0, 0]}>
                <cylinderGeometry args={[1.8, 1.8, 0.9, 12]} />
                <meshPhysicalMaterial 
                  color="#cd853f"
                  metalness={0.85}
                  roughness={0.25}
                  clearcoat={0.4}
                />
              </mesh>
              {/* Center axle */}
              <mesh position={[0, s.height * 0.4, 0]} rotation={[Math.PI / 2, 0, 0]}>
                <cylinderGeometry args={[0.4, 0.4, 1.5, 8]} />
                <meshPhysicalMaterial 
                  color="#8b7355"
                  metalness={0.75}
                  roughness={0.35}
                />
              </mesh>
            </>
          )}
        </group>
      ))}
    </group>
  );
};

// DYSTOPIAN THAMES - Ruined skyscrapers with photorealistic weathered materials
const DystopianThamesLandscape: React.FC<{ side: 'left' | 'right'; boatZ: number }> = ({ side, boatZ }) => {
  const xOffset = side === 'left' ? -35 : 35;
  
  const ruins = useMemo(() => {
    const result: Array<{ x: number; z: number; height: number; width: number; damaged: boolean; rustLevel: number; debrisX: number; debrisZ: number; searchlight: boolean }> = [];
    for (let z = -500; z < 500; z += 30) {
      const i = Math.round((z + 500) / 30);
      const damaged = seededRandom(i * 31 + 5) > 0.4;
      result.push({
        x: xOffset + (seededRandom(i * 31 + 1) - 0.5) * 20,
        z: z + (seededRandom(i * 31 + 2) - 0.5) * 15,
        height: 15 + seededRandom(i * 31 + 3) * 35,
        width: 4 + seededRandom(i * 31 + 4) * 6,
        damaged,
        rustLevel: seededRandom(i * 31 + 6),
        debrisX: (seededRandom(i * 31 + 7) - 0.5),
        debrisZ: (seededRandom(i * 31 + 8) - 0.5),
        searchlight: seededRandom(i * 31 + 9) > 0.75 && !damaged,
      });
    }
    return result;
  }, [xOffset]);
  
  return (
    <group position={[0, 0, boatZ]}>
      {ruins.map((r, i) => {
        const actualHeight = r.damaged ? r.height * 0.7 : r.height;
        const concreteColor = r.rustLevel > 0.6 ? '#1a1a28' : '#1e1e2a';
        
        return (
          <group key={i} position={[r.x, 0, r.z]}>
            {/* Ruined skyscraper with weathered concrete */}
            <mesh position={[0, actualHeight / 2, 0]} castShadow receiveShadow>
              <boxGeometry args={[r.width, actualHeight, r.width]} />
              <meshPhysicalMaterial 
                color={concreteColor}
                roughness={0.94}
                metalness={0.03}
                clearcoat={0.02}
                clearcoatRoughness={0.95}
              />
            </mesh>
            
            {/* Rust streaks and weathering */}
            <mesh position={[r.width / 2 + 0.02, actualHeight * 0.6, 0]}>
              <boxGeometry args={[0.05, actualHeight * 0.5, r.width * 0.3]} />
              <meshPhysicalMaterial 
                color="#3a2820"
                roughness={0.98}
                transparent
                opacity={0.4 + r.rustLevel * 0.3}
              />
            </mesh>
            
            {/* Exposed rebar/steel beams */}
            {r.damaged && (
              <>
                <mesh position={[r.width * 0.3, actualHeight + 0.5, 0]} rotation={[0, 0, 0.3]}>
                  <cylinderGeometry args={[0.08, 0.08, 3, 6]} />
                  <meshPhysicalMaterial 
                    color="#4a3530"
                    roughness={0.7}
                    metalness={0.6}
                  />
                </mesh>
                <mesh position={[-r.width * 0.2, actualHeight + 0.8, r.width * 0.2]} rotation={[0.2, 0, -0.4]}>
                  <cylinderGeometry args={[0.06, 0.06, 2.5, 6]} />
                  <meshPhysicalMaterial color="#3a2a25" roughness={0.75} metalness={0.55} />
                </mesh>
              </>
            )}
            
            {/* Windows with broken glass and emergency lighting */}
            {[0.2, 0.4, 0.6, 0.8].map((yPos, j) => {
              const isBroken = seededRandom(i * 13 + j) > 0.6;
              const hasLight = !isBroken && seededRandom(i * 13 + j + 4) > 0.7;
              return (
                <group key={j}>
                  {/* Window frame */}
                  <mesh position={[r.width / 2 + 0.02, actualHeight * yPos, 0]}>
                    <boxGeometry args={[0.08, 1.4, r.width * 0.65]} />
                    <meshPhysicalMaterial color="#0a0a12" roughness={0.8} metalness={0.2} />
                  </mesh>
                  {/* Glass - either broken or reflective */}
                  {!isBroken && (
                    <mesh position={[r.width / 2 + 0.05, actualHeight * yPos, 0]}>
                      <boxGeometry args={[0.02, 1.2, r.width * 0.6]} />
                      <meshPhysicalMaterial 
                        color="#0f1525"
                        roughness={0.08}
                        metalness={0.92}
                        reflectivity={1.0}
                        clearcoat={1.0}
                        clearcoatRoughness={0.03}
                        emissive={hasLight ? "#ff3030" : "#0a1520"}
                        emissiveIntensity={hasLight ? 0.5 : 0.08}
                        transparent
                        opacity={0.9}
                      />
                    </mesh>
                  )}
                </group>
              );
            })}
            
            {/* Damage debris pile */}
            {r.damaged && (
              <group>
                <mesh position={[r.debrisX * r.width, actualHeight * 0.35 + 1, r.debrisZ * r.width]} rotation={[0.3, 0.5, 0.2]}>
                  <boxGeometry args={[r.width * 0.35, 2.5, r.width * 0.35]} />
                  <meshPhysicalMaterial color="#16213e" roughness={0.96} />
                </mesh>
                {/* Rubble at base */}
                <mesh position={[r.width * 0.5, 0.4, r.width * 0.3]} rotation={[0.1, 0.4, 0.2]}>
                  <dodecahedronGeometry args={[0.8, 0]} />
                  <meshPhysicalMaterial color="#1a1a28" roughness={0.95} />
                </mesh>
                <mesh position={[-r.width * 0.3, 0.3, -r.width * 0.4]} rotation={[0.2, 0.1, 0.3]}>
                  <dodecahedronGeometry args={[0.6, 0]} />
                  <meshPhysicalMaterial color="#161620" roughness={0.94} />
                </mesh>
              </group>
            )}
            
            {/* Searchlight on some buildings */}
            {r.searchlight && (
              <group position={[0, r.height + 1.5, 0]}>
                <mesh>
                  <cylinderGeometry args={[0.15, 0.35, 2.5, 8]} />
                  <meshPhysicalMaterial 
                    color="#2a2a30"
                    roughness={0.6}
                    metalness={0.4}
                  />
                </mesh>
                <mesh position={[0, 1.5, 0]}>
                  <sphereGeometry args={[0.3, 8, 8]} />
                  <meshPhysicalMaterial 
                    color="#ffd60a"
                    emissive="#ffd60a"
                    emissiveIntensity={0.7}
                    roughness={0.2}
                  />
                </mesh>
              </group>
            )}
          </group>
        );
      })}
    </group>
  );
};

// SCI-FI BOSTON - Geometric impossibilities, tesseract architecture, glowing structures
const SciFiBostonLandscape: React.FC<{ side: 'left' | 'right'; boatZ: number }> = ({ side, boatZ }) => {
  const xOffset = side === 'left' ? -35 : 35;
  
  const structures = useMemo(() => {
    const result: Array<{ x: number; z: number; height: number; type: 'tower' | 'cube' | 'pyramid' }> = [];
    for (let z = -500; z < 500; z += 28) {
      const i = Math.round((z + 500) / 28);
      const type = seededRandom(i * 37 + 1) > 0.6 ? 'tower' : (seededRandom(i * 37 + 2) > 0.5 ? 'cube' : 'pyramid');
      result.push({
        x: xOffset + (seededRandom(i * 37 + 3) - 0.5) * 18,
        z: z + (seededRandom(i * 37 + 4) - 0.5) * 14,
        height: 10 + seededRandom(i * 37 + 5) * 25,
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
// HD THEMED SKY/FOG - Enhanced atmosphere with realistic fog gradients
// ============================================================================
const getThemeAtmosphere = (theme: RouteTheme) => {
  switch (theme) {
    case 'crystal-bled':
      // Crystal-clear alpine atmosphere - minimal fog, vibrant blue
      return { 
        fogColor: '#b0ddfa', 
        fogNear: 80, 
        fogFar: 800, 
        skyColor: '#87ceeb',
        ambientColor: '#c0e0ff',
        ambientIntensity: 0.45
      };
    case 'gothic-venice':
      // Heavy venetian mist - mysterious, atmospheric
      return { 
        fogColor: '#2a3a4a', 
        fogNear: 15, 
        fogFar: 250, 
        skyColor: '#1e272e',
        ambientColor: '#4a5a6a',
        ambientIntensity: 0.25
      };
    case 'steampunk-henley':
      // Golden-hour sepia haze - warm, dusty
      return { 
        fogColor: '#9a8365', 
        fogNear: 35, 
        fogFar: 450, 
        skyColor: '#d4a857',
        ambientColor: '#c9a227',
        ambientIntensity: 0.4
      };
    case 'dystopian-thames':
      // Toxic industrial smog - oppressive, dark
      return { 
        fogColor: '#1a1a28', 
        fogNear: 20, 
        fogFar: 300, 
        skyColor: '#0f172a',
        ambientColor: '#2a2a3a',
        ambientIntensity: 0.2
      };
    case 'scifi-boston':
      // Neon-lit night - cool, futuristic
      return { 
        fogColor: '#0a1428', 
        fogNear: 50, 
        fogFar: 550, 
        skyColor: '#162447',
        ambientColor: '#1a3a5a',
        ambientIntensity: 0.3
      };
    default: // Willowbrook - realistic contemporary
      // Natural morning atmosphere - balanced, realistic
      return { 
        fogColor: '#a8d0f0', 
        fogNear: 60, 
        fogFar: 600, 
        skyColor: '#a0cdfa',
        ambientColor: '#b0d0e0',
        ambientIntensity: 0.38
      };
  }
};

// ============================================================================
// HD SKY CONFIGURATION - Enhanced physically-accurate sun and atmosphere
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
  sunIntensity: number;      // Direct sun light intensity
  sunColor: string;          // Sun light color tint
}

const getSkyConfig = (theme: RouteTheme): SkyConfig => {
  switch (theme) {
    case 'crystal-bled':
      // Crystal-clear alpine morning - bright blue sky, high sun, crisp light
      return {
        sunPosition: [120, 100, 60],
        turbidity: 1.2,
        rayleigh: 2.2,
        mieCoefficient: 0.003,
        mieDirectionalG: 0.75,
        inclination: 0.70,
        azimuth: 0.25,
        exposure: 0.55,
        sunIntensity: 2.2,
        sunColor: '#fffaf0'
      };
    case 'gothic-venice':
      // Overcast twilight - low sun, heavy atmosphere, mysterious
      return {
        sunPosition: [40, 12, -120],
        turbidity: 12,
        rayleigh: 3.5,
        mieCoefficient: 0.06,
        mieDirectionalG: 0.96,
        inclination: 0.32,
        azimuth: 0.78,
        exposure: 0.28,
        sunIntensity: 0.8,
        sunColor: '#ff9966'
      };
    case 'steampunk-henley':
      // Golden hour - warm sunset colors, dusty Victorian atmosphere
      return {
        sunPosition: [90, 28, 70],
        turbidity: 9,
        rayleigh: 1.4,
        mieCoefficient: 0.035,
        mieDirectionalG: 0.92,
        inclination: 0.40,
        azimuth: 0.12,
        exposure: 0.48,
        sunIntensity: 1.6,
        sunColor: '#ffcc66'
      };
    case 'dystopian-thames':
      // Polluted dusk - red/orange haze, obscured sun, industrial
      return {
        sunPosition: [25, 6, -90],
        turbidity: 20,
        rayleigh: 0.4,
        mieCoefficient: 0.12,
        mieDirectionalG: 0.99,
        inclination: 0.25,
        azimuth: 0.88,
        exposure: 0.22,
        sunIntensity: 0.5,
        sunColor: '#ff6633'
      };
    case 'scifi-boston':
      // Night with artificial moonlight - cool, futuristic glow
      return {
        sunPosition: [-60, 70, 120],
        turbidity: 0.4,
        rayleigh: 0.15,
        mieCoefficient: 0.0008,
        mieDirectionalG: 0.65,
        inclination: 0.62,
        azimuth: 0.55,
        exposure: 0.18,
        sunIntensity: 0.6,
        sunColor: '#aaccff'
      };
    default: // Willowbrook - realistic contemporary morning
      return {
        sunPosition: [90, 55, 35],
        turbidity: 3.5,
        rayleigh: 2.8,
        mieCoefficient: 0.008,
        mieDirectionalG: 0.82,
        inclination: 0.58,
        azimuth: 0.18,
        exposure: 0.42,
        sunIntensity: 1.8,
        sunColor: '#fff8e8'
      };
  }
};

// HD Cloud configuration - enhanced volumetric cloud settings by theme
interface CloudConfig {
  enabled: boolean;
  count: number;
  opacity: number;
  speed: number;
  color: string;
  segments: number;
  scale: number;
  depth: number;
}

const getCloudConfig = (theme: RouteTheme): CloudConfig => {
  switch (theme) {
    case 'crystal-bled':
      // Sparse, bright white alpine clouds - crisp and defined
      return { 
        enabled: true, 
        count: 5, 
        opacity: 0.42, 
        speed: 0.18, 
        color: '#ffffff', 
        segments: 32,
        scale: 1.3,
        depth: 0.8
      };
    case 'gothic-venice':
      // Heavy, brooding storm clouds - dark and atmospheric
      return { 
        enabled: true, 
        count: 14, 
        opacity: 0.65, 
        speed: 0.06, 
        color: '#5a6268', 
        segments: 38,
        scale: 1.5,
        depth: 1.2
      };
    case 'steampunk-henley':
      // Warm, golden-tinged clouds - dusty Victorian atmosphere
      return { 
        enabled: true, 
        count: 9, 
        opacity: 0.48, 
        speed: 0.12, 
        color: '#f0e0c8', 
        segments: 30,
        scale: 1.2,
        depth: 0.9
      };
    case 'dystopian-thames':
      // Heavy smog and pollution clouds - dark and oppressive
      return { 
        enabled: true, 
        count: 16, 
        opacity: 0.72, 
        speed: 0.04, 
        color: '#3a3a42', 
        segments: 42,
        scale: 1.6,
        depth: 1.4
      };
    case 'scifi-boston':
      // Minimal, wispy night clouds - futuristic and sparse
      return { 
        enabled: true, 
        count: 3, 
        opacity: 0.22, 
        speed: 0.28, 
        color: '#2a4a6a', 
        segments: 22,
        scale: 0.9,
        depth: 0.6
      };
    default: // Willowbrook - natural realistic clouds
      return { 
        enabled: true, 
        count: 8, 
        opacity: 0.38, 
        speed: 0.16, 
        color: '#f8f8ff', 
        segments: 28,
        scale: 1.1,
        depth: 0.85
      };
  }
};

// ============================================================================
// HD PHOTOREALISTIC SKYDOME - Enhanced sky with volumetric clouds and HDR lighting
// ============================================================================
const PhotorealisticSkydome: React.FC<{ theme: RouteTheme; boatZ: number }> = ({ theme, boatZ }) => {
  const skyConfig = useMemo(() => getSkyConfig(theme), [theme]);
  const cloudConfig = useMemo(() => getCloudConfig(theme), [theme]);
  
  // HD Cloud positions with varied heights and distribution
  const cloudPositions = useMemo(() => {
    const positions: Array<{ x: number; y: number; z: number; scale: number; variation: number }> = [];
    for (let i = 0; i < cloudConfig.count; i++) {
      // Golden ratio distribution for natural cloud spacing
      const goldenAngle = Math.PI * (3 - Math.sqrt(5));
      const angle = i * goldenAngle;
      const radiusVariation = 0.7 + seededRandom(i * 41 + 1) * 0.6;
      const radius = (120 + i * 25) * radiusVariation;
      const heightBase = 55 + (i % 3) * 30;
      const heightVariation = seededRandom(i * 41 + 2) * 45;
      
      positions.push({
        x: Math.cos(angle) * radius,
        y: heightBase + heightVariation,
        z: Math.sin(angle) * radius,
        scale: (12 + seededRandom(i * 41 + 3) * 28) * cloudConfig.scale,
        variation: seededRandom(i * 41 + 4)
      });
    }
    return positions;
  }, [cloudConfig.count, cloudConfig.scale]);
  
  // Animate clouds with natural drift patterns
  const cloudGroupRef = useRef<THREE.Group>(null);
  const layer2Ref = useRef<THREE.Group>(null);
  
  useFrame((state) => {
    const time = state.clock.elapsedTime;
    if (cloudGroupRef.current) {
      // Primary cloud layer - gentle rotation with wind simulation
      cloudGroupRef.current.rotation.y = time * cloudConfig.speed * 0.008;
      cloudGroupRef.current.position.x = Math.sin(time * 0.015) * 8;
    }
    if (layer2Ref.current) {
      // Secondary layer - moves at different rate for parallax
      layer2Ref.current.rotation.y = time * cloudConfig.speed * 0.004;
      layer2Ref.current.position.x = Math.sin(time * 0.012 + 1) * 12;
    }
  });
  
  return (
    <group>
      {/* Physically-based sky with enhanced atmospheric scattering */}
      <Sky
        distance={500000}
        sunPosition={skyConfig.sunPosition}
        turbidity={skyConfig.turbidity}
        rayleigh={skyConfig.rayleigh}
        mieCoefficient={skyConfig.mieCoefficient}
        mieDirectionalG={skyConfig.mieDirectionalG}
      />
      
      {/* Primary volumetric cloud layer */}
      {cloudConfig.enabled && (
        <group ref={cloudGroupRef} position={[0, 0, boatZ]}>
          {cloudPositions.map((pos, i) => (
            <Cloud
              key={i}
              position={[pos.x, pos.y, pos.z]}
              opacity={cloudConfig.opacity * (0.65 + pos.variation * 0.35)}
              speed={cloudConfig.speed * (0.8 + pos.variation * 0.4)}
              segments={cloudConfig.segments}
              color={cloudConfig.color}
              scale={pos.scale}
            />
          ))}
        </group>
      )}
      
      {/* Secondary distant cloud layer for HD depth and parallax */}
      {cloudConfig.enabled && (
        <group ref={layer2Ref} position={[0, 160, boatZ - 350]}>
          {[...Array(Math.ceil(cloudConfig.count * 0.4))].map((_, i) => (
            <Cloud
              key={`distant-${i}`}
              position={[
                (i - Math.ceil(cloudConfig.count * 0.2)) * 180 + seededRandom(i * 43 + 1) * 60,
                seededRandom(i * 43 + 2) * 30,
                -150 + seededRandom(i * 43 + 3) * 60
              ]}
              opacity={cloudConfig.opacity * 0.22 * cloudConfig.depth}
              speed={cloudConfig.speed * 0.35}
              segments={Math.floor(cloudConfig.segments * 0.6)}
              color={cloudConfig.color}
              scale={(45 + seededRandom(i * 43 + 4) * 30) * cloudConfig.scale}
            />
          ))}
        </group>
      )}
      
      {/* Tertiary wispy high-altitude clouds for atmosphere */}
      {cloudConfig.enabled && cloudConfig.depth > 0.7 && (
        <group position={[0, 220, boatZ - 500]}>
          {[...Array(2)].map((_, i) => (
            <Cloud
              key={`wispy-${i}`}
              position={[(i - 0.5) * 400, 0, 0]}
              opacity={cloudConfig.opacity * 0.12}
              speed={cloudConfig.speed * 0.2}
              segments={12}
              color={cloudConfig.color}
              scale={80 + seededRandom(i * 47 + 1) * 40}
            />
          ))}
        </group>
      )}
    </group>
  );
};


// ============================================================================
// HIGH-DEFINITION ROWING SCULL (BOAT) with animated oars and realistic rower
// ============================================================================
// This is the always-on HD implementation with realistic proportions and PBR materials.
// Based on modern racing single scull dimensions (~8.2m length, ~0.3m beam).
// All animation refs preserved for seamless gameplay integration.

const RowingScullBase: React.FC<{ cadence: number }> = ({ cadence }) => {
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
  
  useFrame((state) => {
    // Animate based on cadence
    const strokesPerMinute = Math.max(18, cadence || 24);
    const freqHz = strokesPerMinute / 60;
    const time = state.clock.elapsedTime;
    const phase = (time * freqHz % 1);
    
    // Rowing stroke phases:
    // 0.0-0.4: Drive (push with legs, pull with arms, body swings back)
    // 0.4-1.0: Recovery (arms extend, body leans forward, legs compress)
    
    // Smooth easing function
    const easeInOut = (t: number) => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    
    let legCompression: number;
    let armPull: number;
    let bodyLean: number;
    let seatPosition: number;
    
    if (phase < 0.4) {
      // Drive phase - legs extend, arms pull, body swings back
      const t = easeInOut(phase / 0.4);
      legCompression = 1 - t; // 1 (compressed) -> 0 (extended)
      armPull = t; // 0 (arms extended) -> 1 (arms pulled in)
      bodyLean = -0.3 + t * 0.5; // lean forward -> lean back
      seatPosition = -0.5 + t * 0.5; // back -> forward on slide
    } else {
      // Recovery phase - legs compress, arms extend, body leans forward
      const t = easeInOut((phase - 0.4) / 0.6);
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
      if (IS_TEST_MODE) {
        window.__ROWER3D_OAR_ANGLE = oarSweep;
        window.__ROWER3D_STROKE_RATE = strokesPerMinute;
      }
    } catch { /* intentional: window access may fail in test environments */ }
    
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
  
  // HD Skin material with subsurface scattering simulation
  const skinColor = "#e0b89d";
  const skinHighlight = "#f0c8ad";
  const hairColor = "#3d2314";
  const shirtColor = "#1e40af";
  const shirtAccent = "#2563eb";
  const shortsColor = "#1e3a5f";
  
  return (
    <group>
      {/* HD Main hull - racing shell with high-gloss fiberglass finish */}
      <mesh castShadow>
        <boxGeometry args={[0.45, 0.15, 8]} />
        <meshPhysicalMaterial 
          color="#f0e4a8"           // Premium cream/gold fiberglass
          metalness={0.0}
          roughness={0.08}
          clearcoat={1.0}           // High-gloss gel coat finish
          clearcoatRoughness={0.02} // Mirror-smooth clearcoat
          reflectivity={0.95}
          envMapIntensity={1.5}
          sheen={0.4}
          sheenColor="#fffef0"
          sheenRoughness={0.2}
          ior={1.45}
        />
      </mesh>
      
      {/* HD Hull deck with visible grain pattern simulation */}
      <mesh position={[0, 0.08, 0]} castShadow>
        <boxGeometry args={[0.4, 0.02, 7.5]} />
        <meshPhysicalMaterial 
          color="#faf5d8" 
          metalness={0.0} 
          roughness={0.12}
          clearcoat={0.95}
          clearcoatRoughness={0.05}
          sheen={0.25}
          sheenColor="#ffffff"
        />
      </mesh>
      
      {/* HD Bow (front) - aerodynamic point */}
      <mesh position={[0, 0, -4.2]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <coneGeometry args={[0.22, 1.0, 16]} />
        <meshPhysicalMaterial 
          color="#f0e4a8" 
          metalness={0.0} 
          roughness={0.08}
          clearcoat={1.0}
          clearcoatRoughness={0.02}
          reflectivity={0.95}
          sheen={0.4}
          sheenColor="#fffef0"
        />
      </mesh>
      
      {/* HD Stern (back) - tapered stern with racing graphics */}
      <mesh position={[0, 0, 4]} rotation={[-Math.PI / 2, 0, 0]} castShadow>
        <coneGeometry args={[0.2, 0.8, 16]} />
        <meshPhysicalMaterial 
          color="#f0e4a8" 
          metalness={0.0} 
          roughness={0.08}
          clearcoat={1.0}
          clearcoatRoughness={0.02}
          reflectivity={0.95}
        />
      </mesh>
      
      {/* HD Racing stripe on hull */}
      <mesh position={[0, 0.076, 0]}>
        <boxGeometry args={[0.42, 0.005, 7.2]} />
        <meshPhysicalMaterial 
          color="#1e40af"
          metalness={0.0}
          roughness={0.15}
          clearcoat={1.0}
          clearcoatRoughness={0.02}
        />
      </mesh>
      
      {/* HD Sliding seat track - precision machined aluminum */}
      <mesh position={[0, 0.12, 0]}>
        <boxGeometry args={[0.25, 0.02, 1.2]} />
        <meshPhysicalMaterial 
          color="#8a8a8a" 
          metalness={0.92} 
          roughness={0.12}
          clearcoat={0.6}
          clearcoatRoughness={0.15}
        />
      </mesh>
      
      {/* HD Track rails */}
      <mesh position={[-0.1, 0.125, 0]}>
        <boxGeometry args={[0.015, 0.015, 1.25]} />
        <meshPhysicalMaterial color="#606060" metalness={0.95} roughness={0.08} />
      </mesh>
      <mesh position={[0.1, 0.125, 0]}>
        <boxGeometry args={[0.015, 0.015, 1.25]} />
        <meshPhysicalMaterial color="#606060" metalness={0.95} roughness={0.08} />
      </mesh>
      
      {/* HD Sliding seat - ergonomic racing seat */}
      <mesh ref={seatRef} position={[0, 0.18, 0]} castShadow>
        <boxGeometry args={[0.24, 0.045, 0.22]} />
        <meshPhysicalMaterial 
          color="#1a1a1a" 
          metalness={0.2} 
          roughness={0.55}
          clearcoat={0.3}
          clearcoatRoughness={0.4}
        />
      </mesh>
      
      {/* HD Seat wheels */}
      {[[-0.08, 0.14, -0.08], [0.08, 0.14, -0.08], [-0.08, 0.14, 0.08], [0.08, 0.14, 0.08]].map((pos, i) => (
        <mesh key={`wheel-${i}`} position={pos as [number, number, number]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.015, 0.015, 0.02, 12]} />
          <meshPhysicalMaterial color="#303030" metalness={0.8} roughness={0.2} />
        </mesh>
      ))}
      
      {/* HD Foot stretchers - carbon fiber composite */}
      <mesh position={[0, 0.15, -0.6]} rotation={[0.4, 0, 0]}>
        <boxGeometry args={[0.35, 0.03, 0.25]} />
        <meshPhysicalMaterial 
          color="#1a1a1a"
          metalness={0.15}
          roughness={0.45}
          clearcoat={0.7}
          clearcoatRoughness={0.25}
        />
      </mesh>
      
      {/* HD Foot straps */}
      <mesh position={[-0.1, 0.17, -0.55]} rotation={[0.4, 0, 0]}>
        <boxGeometry args={[0.08, 0.02, 0.18]} />
        <meshPhysicalMaterial color="#2a2a2a" roughness={0.85} />
      </mesh>
      <mesh position={[0.1, 0.17, -0.55]} rotation={[0.4, 0, 0]}>
        <boxGeometry args={[0.08, 0.02, 0.18]} />
        <meshPhysicalMaterial color="#2a2a2a" roughness={0.85} />
      </mesh>
      
      {/* ============================================ */}
      {/* HD PHOTOREALISTIC HUMANOID ROWER */}
      {/* ============================================ */}
      <group ref={rowerRef} position={[0, 0.35, 0]}>
        
        {/* TORSO GROUP - rotates for body swing */}
        <group ref={torsoRef} position={[0, 0.15, 0]}>
          
          {/* HD Lower torso / hips - athletic compression shorts */}
          <mesh position={[0, 0, 0]} castShadow>
            <boxGeometry args={[0.28, 0.15, 0.18]} />
            <meshPhysicalMaterial 
              color={shortsColor}
              roughness={0.72}
              metalness={0.0}
              sheen={0.35}
              sheenColor="#3a5a8a"
              sheenRoughness={0.6}
            />
          </mesh>
          
          {/* HD Mid torso / abdomen - athletic fabric */}
          <mesh position={[0, 0.12, 0]} castShadow>
            <boxGeometry args={[0.26, 0.12, 0.16]} />
            <meshPhysicalMaterial 
              color={shirtColor}
              roughness={0.68}
              metalness={0.0}
              sheen={0.45}
              sheenColor={shirtAccent}
              sheenRoughness={0.55}
            />
          </mesh>
          
          {/* HD Upper torso / chest - detailed athletic jersey */}
          <mesh position={[0, 0.26, 0]} castShadow>
            <boxGeometry args={[0.32, 0.16, 0.18]} />
            <meshPhysicalMaterial 
              color={shirtColor}
              roughness={0.65}
              metalness={0.0}
              sheen={0.5}
              sheenColor={shirtAccent}
              sheenRoughness={0.5}
            />
          </mesh>
          
          {/* HD Shoulders - muscular definition */}
          <mesh position={[0, 0.36, 0]} castShadow>
            <boxGeometry args={[0.4, 0.08, 0.14]} />
            <meshPhysicalMaterial 
              color={shirtColor}
              roughness={0.68}
              sheen={0.45}
              sheenColor={shirtAccent}
            />
          </mesh>
          
          {/* HD Neck - realistic skin with subsurface hint */}
          <mesh position={[0, 0.44, 0]} castShadow>
            <cylinderGeometry args={[0.05, 0.06, 0.08, 16]} />
            <meshPhysicalMaterial 
              color={skinColor}
              roughness={0.58}
              metalness={0.0}
              sheen={0.25}
              sheenColor={skinHighlight}
              sheenRoughness={0.7}
              clearcoat={0.08}
              clearcoatRoughness={0.85}
            />
          </mesh>
          
          {/* HD HEAD */}
          <group position={[0, 0.56, 0]}>
            {/* HD Head - realistic skin material */}
            <mesh ref={headRef} castShadow>
              <sphereGeometry args={[0.1, 16, 12]} />
              <meshPhysicalMaterial 
                color={skinColor}
                roughness={0.55}
                metalness={0.0}
                sheen={0.3}
                sheenColor={skinHighlight}
                sheenRoughness={0.65}
                clearcoat={0.1}
                clearcoatRoughness={0.8}
              />
            </mesh>
            
            {/* HD Hair - natural texture */}
            <mesh position={[0, 0.04, -0.02]} castShadow>
              <sphereGeometry args={[0.095, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.6]} />
              <meshPhysicalMaterial 
                color={hairColor}
                roughness={0.88}
                metalness={0.0}
                sheen={0.15}
                sheenColor="#5a3a24"
                sheenRoughness={0.9}
              />
            </mesh>
            
            {/* HD Face features */}
            {/* Nose */}
            <mesh position={[0, -0.01, 0.09]}>
              <boxGeometry args={[0.02, 0.03, 0.02]} />
              <meshPhysicalMaterial color={skinColor} roughness={0.55} sheen={0.2} sheenColor={skinHighlight} />
            </mesh>
            
            {/* HD Eyes with realistic reflection */}
            <mesh position={[-0.03, 0.02, 0.085]}>
              <sphereGeometry args={[0.012, 8, 8]} />
              <meshPhysicalMaterial 
                color="#1a1008"
                roughness={0.12}
                metalness={0.0}
                clearcoat={1.0}
                clearcoatRoughness={0.02}
                reflectivity={0.95}
              />
            </mesh>
            <mesh position={[0.03, 0.02, 0.085]}>
              <sphereGeometry args={[0.012, 8, 8]} />
              <meshPhysicalMaterial 
                color="#1a1008"
                roughness={0.12}
                metalness={0.0}
                clearcoat={1.0}
                clearcoatRoughness={0.02}
                reflectivity={0.95}
              />
            </mesh>
            
            {/* HD Ears with realistic skin */}
            <mesh position={[-0.1, 0, 0]}>
              <sphereGeometry args={[0.025, 8, 8]} />
              <meshPhysicalMaterial 
                color={skinColor}
                roughness={0.58}
                sheen={0.2}
                sheenColor={skinHighlight}
              />
            </mesh>
            <mesh position={[0.1, 0, 0]}>
              <sphereGeometry args={[0.025, 8, 8]} />
              <meshPhysicalMaterial 
                color={skinColor}
                roughness={0.58}
                sheen={0.2}
                sheenColor={skinHighlight}
              />
            </mesh>
          </group>
          
          {/* HD LEFT ARM - athletic musculature */}
          <group ref={leftUpperArmRef} position={[-0.22, 0.32, 0]}>
            {/* Upper arm with muscle definition */}
            <mesh position={[0, -0.1, 0]} castShadow>
              <capsuleGeometry args={[0.038, 0.15, 12, 16]} />
              <meshPhysicalMaterial 
                color={skinColor}
                roughness={0.56}
                sheen={0.28}
                sheenColor={skinHighlight}
                sheenRoughness={0.68}
                clearcoat={0.08}
                clearcoatRoughness={0.85}
              />
            </mesh>
            
            {/* Forearm group - pivots at elbow */}
            <group ref={leftForearmRef} position={[0, -0.2, 0]}>
              <mesh position={[0, -0.1, 0]} castShadow>
                <capsuleGeometry args={[0.032, 0.14, 12, 16]} />
                <meshPhysicalMaterial 
                  color={skinColor}
                  roughness={0.55}
                  sheen={0.26}
                  sheenColor={skinHighlight}
                  sheenRoughness={0.7}
                  clearcoat={0.07}
                  clearcoatRoughness={0.85}
                />
              </mesh>
              
              {/* Hand with realistic skin */}
              <mesh position={[0, -0.22, 0]} castShadow>
                <sphereGeometry args={[0.038, 8, 8]} />
                <meshPhysicalMaterial 
                  color={skinColor}
                  roughness={0.58}
                  sheen={0.22}
                  sheenColor={skinHighlight}
                />
              </mesh>
            </group>
          </group>
          
          {/* HD RIGHT ARM - athletic musculature */}
          <group ref={rightUpperArmRef} position={[0.22, 0.32, 0]}>
            {/* Upper arm with muscle definition */}
            <mesh position={[0, -0.1, 0]} castShadow>
              <capsuleGeometry args={[0.038, 0.15, 12, 16]} />
              <meshPhysicalMaterial 
                color={skinColor}
                roughness={0.56}
                sheen={0.28}
                sheenColor={skinHighlight}
                sheenRoughness={0.68}
                clearcoat={0.08}
                clearcoatRoughness={0.85}
              />
            </mesh>
            
            {/* Forearm group - pivots at elbow */}
            <group ref={rightForearmRef} position={[0, -0.2, 0]}>
              <mesh position={[0, -0.1, 0]} castShadow>
                <capsuleGeometry args={[0.032, 0.14, 12, 16]} />
                <meshPhysicalMaterial 
                  color={skinColor}
                  roughness={0.55}
                  sheen={0.26}
                  sheenColor={skinHighlight}
                  sheenRoughness={0.7}
                  clearcoat={0.07}
                  clearcoatRoughness={0.85}
                />
              </mesh>
              
              {/* Hand with realistic skin */}
              <mesh position={[0, -0.22, 0]} castShadow>
                <sphereGeometry args={[0.038, 8, 8]} />
                <meshPhysicalMaterial 
                  color={skinColor}
                  roughness={0.58}
                  sheen={0.22}
                  sheenColor={skinHighlight}
                />
              </mesh>
            </group>
          </group>
        </group>
        
        {/* HD LEGS - attached to hips, independent of torso rotation */}
        {/* HD LEFT LEG - athletic musculature */}
        <group ref={leftThighRef} position={[-0.08, 0.1, 0]}>
          {/* Thigh with muscular definition */}
          <mesh position={[0, 0, 0.12]} rotation={[Math.PI/2, 0, 0]} castShadow>
            <capsuleGeometry args={[0.052, 0.22, 12, 16]} />
            <meshPhysicalMaterial 
              color={shortsColor}
              roughness={0.7}
              sheen={0.35}
              sheenColor="#3a5a8a"
              sheenRoughness={0.6}
            />
          </mesh>
          
          {/* Shin group - pivots at knee */}
          <group ref={leftShinRef} position={[0, 0, 0.28]}>
            <mesh position={[0, 0, 0.12]} rotation={[Math.PI/2, 0, 0]} castShadow>
              <capsuleGeometry args={[0.042, 0.2, 12, 16]} />
              <meshPhysicalMaterial 
                color={skinColor}
                roughness={0.56}
                sheen={0.25}
                sheenColor={skinHighlight}
                sheenRoughness={0.7}
                clearcoat={0.06}
                clearcoatRoughness={0.85}
              />
            </mesh>
            
            {/* HD Foot - racing shoe */}
            <mesh position={[0, -0.02, 0.3]} castShadow>
              <boxGeometry args={[0.065, 0.035, 0.13]} />
              <meshPhysicalMaterial 
                color="#1a1a1a"
                roughness={0.65}
                metalness={0.05}
                clearcoat={0.25}
                clearcoatRoughness={0.5}
              />
            </mesh>
            {/* Shoe accent */}
            <mesh position={[0, -0.015, 0.32]}>
              <boxGeometry args={[0.06, 0.02, 0.06]} />
              <meshPhysicalMaterial color={shirtAccent} roughness={0.5} />
            </mesh>
          </group>
        </group>
        
        {/* HD RIGHT LEG - athletic musculature */}
        <group ref={rightThighRef} position={[0.08, 0.1, 0]}>
          {/* Thigh with muscular definition */}
          <mesh position={[0, 0, 0.12]} rotation={[Math.PI/2, 0, 0]} castShadow>
            <capsuleGeometry args={[0.052, 0.22, 12, 16]} />
            <meshPhysicalMaterial 
              color={shortsColor}
              roughness={0.7}
              sheen={0.35}
              sheenColor="#3a5a8a"
              sheenRoughness={0.6}
            />
          </mesh>
          
          {/* Shin group - pivots at knee */}
          <group ref={rightShinRef} position={[0, 0, 0.28]}>
            <mesh position={[0, 0, 0.12]} rotation={[Math.PI/2, 0, 0]} castShadow>
              <capsuleGeometry args={[0.042, 0.2, 12, 16]} />
              <meshPhysicalMaterial 
                color={skinColor}
                roughness={0.56}
                sheen={0.25}
                sheenColor={skinHighlight}
                sheenRoughness={0.7}
                clearcoat={0.06}
                clearcoatRoughness={0.85}
              />
            </mesh>
            
            {/* HD Foot - racing shoe */}
            <mesh position={[0, -0.02, 0.3]} castShadow>
              <boxGeometry args={[0.065, 0.035, 0.13]} />
              <meshPhysicalMaterial 
                color="#1a1a1a"
                roughness={0.65}
                metalness={0.05}
                clearcoat={0.25}
                clearcoatRoughness={0.5}
              />
            </mesh>
            {/* Shoe accent */}
            <mesh position={[0, -0.015, 0.32]}>
              <boxGeometry args={[0.06, 0.02, 0.06]} />
              <meshPhysicalMaterial color={shirtAccent} roughness={0.5} />
            </mesh>
          </group>
        </group>
      </group>
      
      {/* HD Left oar group - professional racing equipment */}
      <group ref={leftOarRef} position={[-0.3, 0.15, 0.5]}>
        {/* HD Rigger - aerospace aluminum outrigger */}
        <mesh position={[-0.6, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.028, 0.028, 1.2, 16]} />
          <meshPhysicalMaterial 
            color="#9a9a9a" 
            metalness={0.95} 
            roughness={0.08}
            clearcoat={0.75}
            clearcoatRoughness={0.12}
            reflectivity={0.9}
          />
        </mesh>
        {/* Rigger support struts */}
        <mesh position={[-0.3, -0.08, 0]} rotation={[0, 0, 0.4]}>
          <cylinderGeometry args={[0.012, 0.012, 0.35, 12]} />
          <meshPhysicalMaterial color="#8a8a8a" metalness={0.92} roughness={0.1} />
        </mesh>
        {/* HD Oarlock - precision stainless steel */}
        <mesh position={[-1.15, 0, 0]}>
          <torusGeometry args={[0.045, 0.018, 12, 20]} />
          <meshPhysicalMaterial 
            color="#b8b8b8" 
            metalness={0.98} 
            roughness={0.06}
            clearcoat={0.85}
            clearcoatRoughness={0.08}
            reflectivity={0.95}
          />
        </mesh>
        {/* HD Oar shaft - premium carbon fiber */}
        <mesh position={[-1.8, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.022, 0.028, 2.8, 16]} />
          <meshPhysicalMaterial 
            color="#0a0a0a" 
            metalness={0.15} 
            roughness={0.28}
            clearcoat={0.92}
            clearcoatRoughness={0.08}
            sheen={0.2}
            sheenColor="#303030"
          />
        </mesh>
        {/* Grip area */}
        <mesh position={[-0.35, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.032, 0.032, 0.3, 16]} />
          <meshPhysicalMaterial 
            color="#1a1a1a"
            roughness={0.85}
            metalness={0.0}
          />
        </mesh>
        {/* HD Oar blade - competition composite with team colors */}
        <mesh position={[-3.3, 0, 0]}>
          <boxGeometry args={[0.58, 0.018, 0.2]} />
          <meshPhysicalMaterial 
            color="#1e40af" 
            metalness={0.0} 
            roughness={0.18}
            clearcoat={0.85}
            clearcoatRoughness={0.08}
            sheen={0.35}
            sheenColor="#3b82f6"
          />
        </mesh>
        {/* Blade edge detail */}
        <mesh position={[-3.55, 0, 0]}>
          <boxGeometry args={[0.08, 0.016, 0.19]} />
          <meshPhysicalMaterial color="#0f2460" roughness={0.2} clearcoat={0.8} />
        </mesh>
      </group>
      
      {/* HD Right oar group - professional racing equipment */}
      <group ref={rightOarRef} position={[0.3, 0.15, 0.5]}>
        {/* HD Rigger - aerospace aluminum outrigger */}
        <mesh position={[0.6, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.028, 0.028, 1.2, 16]} />
          <meshPhysicalMaterial 
            color="#9a9a9a" 
            metalness={0.95} 
            roughness={0.08}
            clearcoat={0.75}
            clearcoatRoughness={0.12}
            reflectivity={0.9}
          />
        </mesh>
        {/* Rigger support struts */}
        <mesh position={[0.3, -0.08, 0]} rotation={[0, 0, -0.4]}>
          <cylinderGeometry args={[0.012, 0.012, 0.35, 12]} />
          <meshPhysicalMaterial color="#8a8a8a" metalness={0.92} roughness={0.1} />
        </mesh>
        {/* HD Oarlock - precision stainless steel */}
        <mesh position={[1.15, 0, 0]}>
          <torusGeometry args={[0.045, 0.018, 12, 20]} />
          <meshPhysicalMaterial 
            color="#b8b8b8" 
            metalness={0.98} 
            roughness={0.06}
            clearcoat={0.85}
            clearcoatRoughness={0.08}
            reflectivity={0.95}
          />
        </mesh>
        {/* HD Oar shaft - premium carbon fiber */}
        <mesh position={[1.8, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.022, 0.028, 2.8, 16]} />
          <meshPhysicalMaterial 
            color="#0a0a0a" 
            metalness={0.15} 
            roughness={0.28}
            clearcoat={0.92}
            clearcoatRoughness={0.08}
            sheen={0.2}
            sheenColor="#303030"
          />
        </mesh>
        {/* Grip area */}
        <mesh position={[0.35, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.032, 0.032, 0.3, 16]} />
          <meshPhysicalMaterial 
            color="#1a1a1a"
            roughness={0.85}
            metalness={0.0}
          />
        </mesh>
        {/* HD Oar blade - competition composite with team colors */}
        <mesh position={[3.3, 0, 0]}>
          <boxGeometry args={[0.58, 0.018, 0.2]} />
          <meshPhysicalMaterial 
            color="#1e40af" 
            metalness={0.0} 
            roughness={0.18}
            clearcoat={0.85}
            clearcoatRoughness={0.08}
            sheen={0.35}
            sheenColor="#3b82f6"
          />
        </mesh>
        {/* Blade edge detail */}
        <mesh position={[3.55, 0, 0]}>
          <boxGeometry args={[0.08, 0.016, 0.19]} />
          <meshPhysicalMaterial color="#0f2460" roughness={0.2} clearcoat={0.8} />
        </mesh>
      </group>
    </group>
  );
};

// Memoize so the boat only re-renders when cadence changes.
// Position and rotation are driven imperatively — either via a parent group ref
// (Playwright mode) or via a Rapier kinematic body (normal mode).
const RowingScull = React.memo(RowingScullBase, (prev, next) => prev.cadence === next.cadence);

// ============================================================================
// BOAT KINEMATIC CONTROLLER — Drives a Rapier kinematic rigid body from the
// route-following refs so position/rotation live in the physics world without
// fighting the CatmullRom curve constraint. No forces are applied; Rapier just
// owns the transform, enabling future collision detection with scene objects.
// ============================================================================
const BoatKinematicController: React.FC<{
  positionRef: React.MutableRefObject<THREE.Vector3>;
  rotationRef: React.MutableRefObject<number>;
  cadence: number;
}> = ({ positionRef, rotationRef, cadence }) => {
  const bodyRef = useRef<RapierRigidBody>(null);

  useFrame(() => {
    if (!bodyRef.current) return;
    bodyRef.current.setNextKinematicTranslation({
      x: positionRef.current.x,
      y: positionRef.current.y,
      z: positionRef.current.z,
    });
    // Convert Y-axis rotation angle to unit quaternion
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
      <RowingScull cadence={cadence} />
    </RigidBody>
  );
};

// ============================================================================
// DYNAMIC POST-PROCESSING — velocity-gated chromatic aberration + depth-of-field
// + bloom, vignette, ACES filmic tone mapping. Runs inside the R3F canvas so
// it can access useFrame for per-frame effect updates without React state churn.
// ============================================================================
const ChromaticAberrationDriver: React.FC<{
  effect: ChromaticAberrationEffect;
  velocityRef: React.MutableRefObject<number>;
}> = ({ effect, velocityRef }) => {
  // Scale chromatic aberration with boat speed: silent at rest, subtle at sprint pace
  useFrame(() => {
    const vel = velocityRef.current;
    const aberration = Math.min(vel / 8.0, 1.0) * 0.0018;
    effect.offset.set(aberration, aberration * 0.6);
  });
  return null;
};

const DynamicPostFx: React.FC<{ velocityRef: React.MutableRefObject<number>; isHighQuality: boolean }> = ({ velocityRef, isHighQuality }) => {
  // Create ChromaticAberrationEffect directly (not via the @react-three/postprocessing P-wrapper)
  // to avoid React 19's ref-as-prop behaviour causing JSON.stringify on the circular __r3f instance.
  const caEffect = useMemo(
    () => (isHighQuality
      ? new ChromaticAberrationEffect({ offset: new THREE.Vector2(0, 0), radialModulation: false, modulationOffset: 0 })
      : null),
    [isHighQuality],
  );
  useEffect(() => {
    return () => {
      caEffect?.dispose();
    };
  }, [caEffect]);

  return isHighQuality ? (
    <EffectComposer>
      <ChromaticAberrationDriver effect={caEffect!} velocityRef={velocityRef} />
      <Bloom intensity={0.28} luminanceThreshold={0.72} luminanceSmoothing={0.85} />
      <primitive object={caEffect!} />
      <DepthOfField worldFocusDistance={10} worldFocusRange={25} bokehScale={2} height={480} />
      <Vignette eskil={false} offset={0.3} darkness={0.5} />
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
    </EffectComposer>
  ) : (
    <EffectComposer>
      <Vignette eskil={false} offset={0.3} darkness={0.5} />
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
    </EffectComposer>
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
  intensityFactor,
  performanceMode
}) => {
  const { camera } = useThree();
  const isHighQuality = performanceMode !== 'low';
  
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
  // Doubles as the persistent scratch position vector for getRoutePositionAtProgress.
  const boatPositionRef = useRef<THREE.Vector3>(new THREE.Vector3(0, 0, 0));
  // Persistent scratch tangent vector — paired with boatPositionRef above, the two are
  // passed into getRoutePositionAtProgress every frame so the curve sample is written
  // in-place. Saves ~2 Vector3 allocations per frame (~120/sec) on the render hot path.
  const scratchTangentRef = useRef<THREE.Vector3>(new THREE.Vector3());
  // Batched scenery state — both updates in one object to halve React re-renders
  const [sceneryState, setSceneryState] = useState({ boatProgress: 0, boatZ: 0 });
  const { boatProgress, boatZ } = sceneryState;

  // Ref to the boat group used for imperative positioning in Playwright mode
  const boatGroupRef = useRef<THREE.Group>(null);
  // Tracks last time scenery state was updated — throttles to ≤ 10 Hz
  const lastSceneryUpdateRef = useRef<number>(0);
  
  // Calculate total route distance in meters
  const totalDistance = useMemo(() => {
    return routeTotalDistanceMeters(route.coordinates);
  }, [route.coordinates]);

  // Wasm physics engine (falls back to JS pace→speed if unavailable)
  const { boatState, dispatchTick } = usePhysicsEngine();

  // Expose stroke phase and velocity via refs for child components (avoids re-renders)
  const strokeCycleTRef = useRef(0);
  const velocityRef = useRef(0);
  useEffect(() => {
    strokeCycleTRef.current = boatState.strokeCycleT;
    velocityRef.current = boatState.velocityMps;
  }, [boatState.strokeCycleT, boatState.velocityMps]);

  // Animation loop - move boat along curved path and camera follows
  useFrame((state, delta) => {
    // Get speed from Wasm physics engine (or JS fallback).
    // Build a minimal PM5Data-compatible object from available props.
    const pm5Data = {
      pace: paceSPer500 ?? undefined,
      power: undefined,     // PM5 power not plumbed through here yet
      cadence: cadence ?? undefined,
      distance: distanceMeters ?? 0,
      elapsedTime: 0,
    };
    let speedMps = dispatchTick(delta, pm5Data);
    
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
    } else if (!isPlaying && distanceMeters !== null && distanceMeters !== undefined && totalDistance > 0) {
      // When not playing, smooth position to distance-based progress.
      // Guard: never enter this branch while playing — it can cause progress to regress
      // if speedMps is momentarily 0 (e.g. during Wasm engine warm-up).
      targetProgress = distanceToProgress(
        distanceMeters,
        totalDistance,
        curveData.distances,
        curveData.length
      );
      // Smooth transition to target
      boatProgressRef.current += (targetProgress - boatProgressRef.current) * delta * 3;
    }
    
    // Get boat position and rotation from curve — write directly into the persistent
    // refs to avoid per-frame Vector3 allocations.
    const routePos = getRoutePositionAtProgress(
      routeCurve,
      boatProgressRef.current,
      boatPositionRef.current,
      scratchTangentRef.current,
    );
    boatRotationRef.current = routePos.angle;
    
    // Imperatively position boat group when Rapier is absent (Playwright or physics fallback)
    if (boatGroupRef.current) {
      boatGroupRef.current.position.copy(boatPositionRef.current);
      boatGroupRef.current.rotation.y = boatRotationRef.current;
    }

    // Update state for scenery positioning — throttled to ≤ 10 Hz to reduce React re-renders.
    // Batched into a single setState to halve render count.
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
    
    // Expose boat position and physics telemetry for Playwright testing
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
        window.__ROWER3D_STROKE_PHASE = boatState.strokePhase;
        window.__ROWER3D_DISTANCE_M = boatProgressRef.current * totalDistance;
      }
    } catch { /* intentional: window access may fail in test environments */ }
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
        <CurvedWaterChannel curve={routeCurve} theme={routeTheme} isHighQuality={isHighQuality} />
      ) : (
        <PhotorealisticWater boatZ={boatZ} theme={routeTheme} isHighQuality={isHighQuality} />
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
      
      {/* The rowing scull — kinematic Rapier body in normal mode; imperative group in Playwright mode.
          PhysicsErrorBoundary catches Rapier WASM init failures so the rest of the scene remains visible. */}
      {IS_TEST_MODE ? (
        <group ref={boatGroupRef}>
          <RowingScull cadence={cadence || 30} />
        </group>
      ) : (
        <PhysicsErrorBoundary fallback={
          <group ref={boatGroupRef}>
            <RowingScull cadence={cadence || 30} />
          </group>
        }>
          <Physics gravity={[0, -9.81, 0]}>
            <BoatKinematicController
              positionRef={boatPositionRef}
              rotationRef={boatRotationRef}
              cadence={cadence || 30}
            />
          </Physics>
        </PhysicsErrorBoundary>
      )}

      {/* V-shaped Kelvin wake trailing behind the boat — disabled in test mode */}
      {!IS_TEST_MODE && (
        <WakeEffect
          positionRef={boatPositionRef}
          rotationRef={boatRotationRef}
          velocityRef={velocityRef}
        />
      )}

      {/* White foam sprites at oar blade-entry point — disabled in test mode */}
      {!IS_TEST_MODE && (
        <BladeEntryFoam
          positionRef={boatPositionRef}
          rotationRef={boatRotationRef}
          strokePhase={boatState.strokePhase}
        />
      )}

      {/* Post-processing effects for photorealism - disabled in test mode */}
      {!IS_TEST_MODE && <DynamicPostFx velocityRef={velocityRef} isHighQuality={isHighQuality} />}
    </>
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
            // Store max anisotropy for texture quality optimization (#109)
            try {
              window.__ROWER3D_MAX_ANISOTROPY = gl.capabilities.getMaxAnisotropy();
            } catch { /* intentional */ }
            try {
              window.__ROWER3D_GPU_BACKEND = gpuBackend;
            } catch { /* intentional */ }
            
            // Handle WebGL context lost/restored for Playwright tests
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
