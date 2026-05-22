import React, { useRef, useMemo, useEffect, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Sky, Cloud, useCubeCamera, useGLTF, MeshReflectorMaterial } from '@react-three/drei';
import { EffectComposer, Bloom, ToneMapping, Vignette, DepthOfField, SSAO, GodRays, HueSaturation, BrightnessContrast } from '@react-three/postprocessing';
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
import { getThemeConfig } from './rower3d/themeConfig';
import type { RouteTheme, ColorGradingConfig, TreeSpeciesEntry } from './rower3d/themeConfig';
import { AnimationProvider, useAnimationFrame } from './rower3d/AnimationContext';
import { getRouteLandmarkConfig, LandmarkRenderer } from './routeLandmarks';
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

const RENDER_CONFIG = {
  /** Progress-band around boat for landscape shadow casting (0..1) */
  shadowNearProgressBand: 0.08,
  /** World-unit band around boat for non-curve landscape shadow casting */
  shadowNearBand: 150,
} as const;

// GPU backend type for renderer selection
type GPUBackend = 'webgpu' | 'webgl' | 'none';
type PerformanceMode = 'auto' | 'high' | 'low';

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

// Deterministic seeded pseudo-random — avoids Math.random() impurity in render.
// Returns a stable value in [0, 1) for a given seed integer.
function seededRandom(seed: number): number {
  const s = Math.sin(seed * 9301 + 49297) * 233280;
  return s - Math.floor(s);
}

// ============================================================================
// PROCEDURAL TEXTURE GENERATORS — #116, #106, #123
// ============================================================================

/** Procedural normal map for boat hull surface grain (#116). */
function createBoatNormalMap(): THREE.Texture {
  const canvas = document.createElement('canvas');
  canvas.width = 64; canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#8080ff';
  ctx.fillRect(0, 0, 64, 64);
  for (let y = 0; y < 64; y += 4) {
    ctx.strokeStyle = `rgba(120,120,250,0.3)`;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(64, y); ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(4, 2);
  return tex;
}

/** Procedural normal map for Gerstner water ripple detail (#106). */
function createWaterNormalMap(frequency: number): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const imageData = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const nx = Math.sin(x * frequency * 0.3) * 0.5 + 0.5;
      const ny = Math.cos(y * frequency * 0.3) * 0.5 + 0.5;
      const i = (y * size + x) * 4;
      imageData.data[i]   = Math.floor(nx * 128 + 64);
      imageData.data[i+1] = Math.floor(ny * 128 + 64);
      imageData.data[i+2] = 255;
      imageData.data[i+3] = 255;
    }
  }
  ctx.putImageData(imageData, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(8, 8);
  return tex;
}

/** Voronoi-ish caustics cookie texture for the CausticsLight SpotLight (#123). */
function createCausticsTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256; canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, 256, 256);
  // Use a fixed-seed loop so the texture is deterministic
  for (let i = 0; i < 20; i++) {
    const x = seededRandom(i * 7 + 1) * 256;
    const y = seededRandom(i * 7 + 2) * 256;
    const r = 10 + seededRandom(i * 7 + 3) * 30;
    const g = ctx.createRadialGradient(x, y, r * 0.3, x, y, r);
    g.addColorStop(0, 'rgba(200,220,255,0.8)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 256, 256);
  }
  return new THREE.CanvasTexture(canvas);
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
  waveAmplitude: number = 1.0,
  waveFrequency: number = 1.0,
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
    vec2 wGrad = gWaveGrad(wXY, vec2( 1.0,  0.3), ${(0.15 * waveAmplitude).toFixed(4)}, ${(0.020 * waveFrequency).toFixed(4)}, 0.80)
               + gWaveGrad(wXY, vec2(-0.3,  1.0), ${(0.12 * waveAmplitude).toFixed(4)}, ${(0.025 * waveFrequency).toFixed(4)}, 0.60)
               + gWaveGrad(wXY, vec2( 0.7,  0.7), ${(0.08 * waveAmplitude).toFixed(4)}, ${(0.015 * waveFrequency).toFixed(4)}, 1.10)
               + gWaveGrad(wXY, vec2( 0.5, -0.5), ${(0.04 * waveAmplitude).toFixed(4)}, ${(0.050 * waveFrequency).toFixed(4)}, 1.50);
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
    float wH = gWave(wXY, vec2( 1.0,  0.3), ${(0.15 * waveAmplitude).toFixed(4)}, ${(0.020 * waveFrequency).toFixed(4)}, 0.80)
             + gWave(wXY, vec2(-0.3,  1.0), ${(0.12 * waveAmplitude).toFixed(4)}, ${(0.025 * waveFrequency).toFixed(4)}, 0.60)
             + gWave(wXY, vec2( 0.7,  0.7), ${(0.08 * waveAmplitude).toFixed(4)}, ${(0.015 * waveFrequency).toFixed(4)}, 1.10)
             + gWave(wXY, vec2( 0.5, -0.5), ${(0.04 * waveAmplitude).toFixed(4)}, ${(0.050 * waveFrequency).toFixed(4)}, 1.50);
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
  foamIntensity?: number;
}> = ({ positionRef, rotationRef, strokePhase, foamIntensity = 0.65 }) => {
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
    const alpha = foamLifeRef.current * foamIntensity;

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
// PMREM ENVIRONMENT — generates env map from the procedural skydome via
// PMREMGenerator, replacing the static drei Environment preset (#121).
// Regenerates only when the route theme changes to avoid per-frame cost.
// ============================================================================
const PMREMEnvironment: React.FC<{ theme: RouteTheme }> = ({ theme }) => {
  const { gl, scene } = useThree();
  useEffect(() => {
    if (IS_TEST_MODE) return;
    const pmremGen = new THREE.PMREMGenerator(gl);
    pmremGen.compileEquirectangularShader();
    const envRT = pmremGen.fromScene(scene);
    scene.environment = envRT.texture;
    return () => {
      envRT.texture.dispose();
      envRT.dispose();
      pmremGen.dispose();
      scene.environment = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gl, scene, theme]);
  return null;
};

// ============================================================================
// DRIVE SPRAY — small spray particles at blade-entry sites during 'drive'
// phase (#122). Uses pre-allocated BufferGeometry; no external particle lib.
// ============================================================================
const DRIVE_PARTICLE_COUNT = 24;
const DriveSpray: React.FC<{
  positionRef: React.MutableRefObject<THREE.Vector3>;
  rotationRef: React.MutableRefObject<number>;
  strokePhase: string;
}> = ({ positionRef, rotationRef, strokePhase }) => {
  const pointsRef = useRef<THREE.Points | null>(null);
  const velArray = useRef(new Float32Array(DRIVE_PARTICLE_COUNT * 3));
  const lifeArray = useRef(new Float32Array(DRIVE_PARTICLE_COUNT));
  const prevPhaseRef = useRef('recovery');
  const { scene } = useThree();

  useEffect(() => {
    const posData = new Float32Array(DRIVE_PARTICLE_COUNT * 3).fill(-9999);
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(posData, 3));
    const mat = new THREE.PointsMaterial({ color: 'white', size: 0.18, transparent: true, opacity: 0, depthWrite: false, sizeAttenuation: true });
    const pts = new THREE.Points(geom, mat);
    pointsRef.current = pts;
    scene.add(pts);
    return () => { scene.remove(pts); geom.dispose(); mat.dispose(); pointsRef.current = null; };
  }, [scene]);

  useFrame((_, delta) => {
    const pts = pointsRef.current;
    if (!pts) return;
    const mat = pts.material as THREE.PointsMaterial;
    const attr = pts.geometry.getAttribute('position') as THREE.BufferAttribute;
    const pos = attr.array as Float32Array;

    if (strokePhase === 'drive' && prevPhaseRef.current !== 'drive') {
      const bp = positionRef.current;
      const rot = rotationRef.current;
      const cosR = Math.cos(rot);
      const sinR = Math.sin(rot);
      const span = 3.2;
      for (let i = 0; i < DRIVE_PARTICLE_COUNT; i++) {
        const side = i < DRIVE_PARTICLE_COUNT / 2 ? -1 : 1;
        pos[i * 3 + 0] = bp.x + side * cosR * span + (Math.random() - 0.5) * 0.4;
        pos[i * 3 + 1] = bp.y + 0.05;
        pos[i * 3 + 2] = bp.z - side * sinR * span + (Math.random() - 0.5) * 0.4;
        velArray.current[i * 3 + 0] = (Math.random() - 0.5) * 1.5;
        velArray.current[i * 3 + 1] = Math.random() * 1.2 + 0.3;
        velArray.current[i * 3 + 2] = (Math.random() - 0.5) * 1.5;
        lifeArray.current[i] = 0.4 + Math.random() * 0.3;
      }
    }
    prevPhaseRef.current = strokePhase;

    let anyAlive = false;
    for (let i = 0; i < DRIVE_PARTICLE_COUNT; i++) {
      if (lifeArray.current[i] <= 0) continue;
      lifeArray.current[i] -= delta;
      if (lifeArray.current[i] <= 0) {
        pos[i * 3 + 1] = -9999;
      } else {
        anyAlive = true;
        pos[i * 3 + 0] += velArray.current[i * 3 + 0] * delta;
        pos[i * 3 + 1] += velArray.current[i * 3 + 1] * delta;
        pos[i * 3 + 2] += velArray.current[i * 3 + 2] * delta;
        velArray.current[i * 3 + 1] -= 5.0 * delta;
      }
    }
    mat.opacity = anyAlive ? 0.65 : 0;
    mat.visible = anyAlive;
    attr.needsUpdate = true;
  });

  return null;
};

// ============================================================================
// FINISH SPLASH — brief burst at blade-exit on 'finish' phase (#122).
// ============================================================================
const FINISH_PARTICLE_COUNT = 32;
const FinishSplash: React.FC<{
  positionRef: React.MutableRefObject<THREE.Vector3>;
  rotationRef: React.MutableRefObject<number>;
  strokePhase: string;
}> = ({ positionRef, rotationRef, strokePhase }) => {
  const pointsRef = useRef<THREE.Points | null>(null);
  const velArray = useRef(new Float32Array(FINISH_PARTICLE_COUNT * 3));
  const lifeArray = useRef(new Float32Array(FINISH_PARTICLE_COUNT));
  const prevPhaseRef = useRef('drive');
  const { scene } = useThree();

  useEffect(() => {
    const posData = new Float32Array(FINISH_PARTICLE_COUNT * 3).fill(-9999);
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(posData, 3));
    const mat = new THREE.PointsMaterial({ color: '#cceeff', size: 0.22, transparent: true, opacity: 0, depthWrite: false, sizeAttenuation: true });
    const pts = new THREE.Points(geom, mat);
    pointsRef.current = pts;
    scene.add(pts);
    return () => { scene.remove(pts); geom.dispose(); mat.dispose(); pointsRef.current = null; };
  }, [scene]);

  useFrame((_, delta) => {
    const pts = pointsRef.current;
    if (!pts) return;
    const mat = pts.material as THREE.PointsMaterial;
    const attr = pts.geometry.getAttribute('position') as THREE.BufferAttribute;
    const pos = attr.array as Float32Array;

    if (strokePhase === 'finish' && prevPhaseRef.current !== 'finish') {
      const bp = positionRef.current;
      const rot = rotationRef.current;
      const cosR = Math.cos(rot);
      const sinR = Math.sin(rot);
      const span = 3.2;
      for (let i = 0; i < FINISH_PARTICLE_COUNT; i++) {
        const side = i < FINISH_PARTICLE_COUNT / 2 ? -1 : 1;
        pos[i * 3 + 0] = bp.x + side * cosR * span + (Math.random() - 0.5) * 0.6;
        pos[i * 3 + 1] = bp.y + 0.05;
        pos[i * 3 + 2] = bp.z - side * sinR * span + (Math.random() - 0.5) * 0.6;
        const angle = Math.random() * Math.PI * 2;
        const speed = Math.random() * 2.0 + 0.5;
        velArray.current[i * 3 + 0] = Math.cos(angle) * speed;
        velArray.current[i * 3 + 1] = Math.random() * 1.8 + 0.5;
        velArray.current[i * 3 + 2] = Math.sin(angle) * speed;
        lifeArray.current[i] = 0.3 + Math.random() * 0.4;
      }
    }
    prevPhaseRef.current = strokePhase;

    let anyAlive = false;
    for (let i = 0; i < FINISH_PARTICLE_COUNT; i++) {
      if (lifeArray.current[i] <= 0) continue;
      lifeArray.current[i] -= delta;
      if (lifeArray.current[i] <= 0) {
        pos[i * 3 + 1] = -9999;
      } else {
        anyAlive = true;
        pos[i * 3 + 0] += velArray.current[i * 3 + 0] * delta;
        pos[i * 3 + 1] += velArray.current[i * 3 + 1] * delta;
        pos[i * 3 + 2] += velArray.current[i * 3 + 2] * delta;
        velArray.current[i * 3 + 1] -= 6.0 * delta;
      }
    }
    mat.opacity = anyAlive ? 0.7 : 0;
    mat.visible = anyAlive;
    attr.needsUpdate = true;
  });

  return null;
};

// ============================================================================
// WATER REFLECTION PROBE — CubeCamera that provides real-time env reflections
// Updates every 30 frames so performance cost is amortised. The water mesh is
// temporarily hidden during the render pass to prevent self-reflection artefacts.
// ============================================================================
const WaterReflectionProbe: React.FC<{
  materialRef: React.MutableRefObject<THREE.MeshPhysicalMaterial | null>;
  meshRef: React.MutableRefObject<THREE.Mesh | null>;
  performanceMode?: PerformanceMode;
}> = ({ materialRef, meshRef, performanceMode }) => {
  const { fbo, update } = useCubeCamera({ resolution: 64, near: 0.5, far: 600 });
  const frameRef = useRef(0);
  const interval = performanceMode === 'auto' ? 60 : 30;

  useFrame(() => {
    frameRef.current++;
    if (frameRef.current % interval !== 0) return;
    // Hide water surface so it doesn't self-reflect
    if (meshRef.current) meshRef.current.visible = false;
    update();
    if (meshRef.current) meshRef.current.visible = true;
    if (materialRef.current) {
      materialRef.current.envMap = fbo.texture;
      materialRef.current.envMapIntensity = 0.35;
    }
  });

  // Clear envMap reference on unmount so the material doesn't reference a disposed FBO
  useEffect(() => {
    return () => {
      if (materialRef.current) {
        materialRef.current.envMap = null;
        materialRef.current.needsUpdate = true;
      }
    };
  }, [materialRef]);

  return null;
};

// ============================================================================
// HIGH-DEFINITION PHOTOREALISTIC WATER - Advanced PBR with realistic waves,
// subsurface scattering simulation, and theme-appropriate depth effects
// ============================================================================
const PhotorealisticWater: React.FC<{ boatZ: number; theme: RouteTheme; performanceMode?: PerformanceMode }> = ({ boatZ, theme, performanceMode }) => {
  const materialRef    = useRef<THREE.MeshPhysicalMaterial>(null);
  const meshRef        = useRef<THREE.Mesh>(null);
  const timeUniformRef = useRef({ value: 0 });

  // HD Theme-based water configurations with enhanced realism
  const waterConfig = useMemo(() => getThemeConfig(theme).water, [theme]);

  // Dual scrolling normal maps for Gerstner wave surface detail (#106)
  const waterNormalMap = useMemo(() => createWaterNormalMap(3.0), []);
  useEffect(() => () => { waterNormalMap.dispose(); }, [waterNormalMap]);
  
  // Attach GPU Gerstner wave shader whenever theme changes (requires material recompile).
  // Skipped in Playwright: shader recompilation after context-restore stalls the page.
  useEffect(() => {
    if (IS_TEST_MODE) return;
    const mat = materialRef.current;
    if (!mat) return;
    attachGerstnerShader(mat, timeUniformRef.current, 'z', theme, waterConfig.waveAmplitude, waterConfig.waveFrequency);
    mat.needsUpdate = true;
  }, [theme]);

  // Update time uniform and material animation properties each frame
  useAnimationFrame((time) => {
    timeUniformRef.current.value = time;

    if (materialRef.current) {
      // Dynamic roughness — wind-driven micro-ripples
      const windVariation = Math.sin(time * 0.3) * 0.015 + Math.sin(time * 0.7) * 0.008;
      materialRef.current.roughness = waterConfig.roughness + windVariation;

      // Subtle emissive pulsing simulating light caustics
      const causticPulse = (Math.sin(time * 1.2) * 0.5 + 0.5) * 0.02;
      materialRef.current.emissiveIntensity = waterConfig.emissiveIntensity + causticPulse;
    }

    // Scroll the water normal map UV offsets for animated ripple detail (#106)
    waterNormalMap.offset.x = (time * 0.02) % 1;
    waterNormalMap.offset.y = (time * 0.01) % 1;
    waterNormalMap.needsUpdate = true;
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
        <planeGeometry args={[1000, 1000, performanceMode !== 'low' ? 64 : 32, performanceMode !== 'low' ? 64 : 32]} />
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
          normalMap={waterNormalMap}
          normalScale={new THREE.Vector2(0.15, 0.15)}
        />
      </mesh>
      {!IS_TEST_MODE && performanceMode !== 'low' && (
        <WaterReflectionProbe materialRef={materialRef} meshRef={meshRef} performanceMode={performanceMode} />
      )}
    </>
  );
};

// ============================================================================
// WATER REFLECTION PLANE — flat plane with MeshReflectorMaterial providing
// planar reflections of the boat and sky on the water surface (#119).
// Rendered only on non-low performance modes; sits just below the Gerstner
// water mesh so animated waves show through the transparent PBR water above.
// ============================================================================
const WaterReflectionPlane: React.FC<{ boatZ: number; theme: RouteTheme }> = ({ boatZ, theme }) => {
  const waterConfig = useMemo(() => getThemeConfig(theme).water, [theme]);
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.12, boatZ]}>
      <planeGeometry args={[1000, 1000]} />
      <MeshReflectorMaterial
        resolution={256}
        blur={[300, 100]}
        color={waterConfig.color}
        roughness={1}
        metalness={0.8}
        mirror={0.5}
      />
    </mesh>
  );
};

// ============================================================================
// HD MIST LAYER - Multi-layered volumetric fog for atmospheric depth
// ============================================================================
const MistLayer: React.FC<{ boatZ: number; theme: RouteTheme }> = ({ boatZ, theme }) => {
  const layer1Ref = useRef<THREE.Mesh>(null);
  const layer2Ref = useRef<THREE.Mesh>(null);
  
  // HD mist configuration with multiple layers
  const mistConfig = useMemo(() => getThemeConfig(theme).mist, [theme]);
  
  // Animate mist drift for realism
  useAnimationFrame((time) => {
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
}

const CurvedWaterChannel: React.FC<CurvedWaterChannelProps> = ({ curve, theme }) => {
  const meshRef        = useRef<THREE.Mesh>(null);
  const materialRef    = useRef<THREE.MeshPhysicalMaterial>(null);
  const timeUniformRef = useRef({ value: 0 });
  
  // HD Theme-based water colors with enhanced realism (matches PhotorealisticWater)
  const waterConfig = useMemo(() => getThemeConfig(theme).water, [theme]);
  
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
  useAnimationFrame((time) => {
    timeUniformRef.current.value = time;
    if (materialRef.current) {
      const windVariation = Math.sin(time * 0.3) * 0.012 + Math.sin(time * 0.7) * 0.006;
      materialRef.current.roughness = waterConfig.roughness + windVariation;
    }
  });
  
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

  // Dispose geometry when curve changes or component unmounts to prevent GPU memory leaks
  useEffect(() => {
    return () => {
      waterGeometry?.dispose();
    };
  }, [waterGeometry]);

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
  const bankConfig = useMemo(() => getThemeConfig(theme).bank, [theme]);
  
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
  const colors = useMemo(() => getThemeConfig(theme).landscapeColors, [theme]);

  // Per-theme architecture config (#129)
  const archConfig = useMemo(() => getThemeConfig(theme).architecture, [theme]);

  // Camera for distance-based LOD (#105)
  const { camera } = useThree();

  // Sway time uniform and foliage materials with wind-sway shader (#107)
  const swayTime = useMemo<THREE.IUniform<number>>(() => ({ value: 0 }), []);
  const curveFoliageMats = useMemo(() => [
    makeSwayFoliageMaterial({ color: colors.tree, roughness: 0.78, metalness: 0.0, transmission: 0.08, thickness: 0.6, sheen: 0.45, sheenColor: new THREE.Color(colors.treeHighlight), sheenRoughness: 0.7 }, swayTime),
    makeSwayFoliageMaterial({ color: colors.tree, roughness: 0.74, metalness: 0.0, transmission: 0.10, thickness: 0.5, sheen: 0.52, sheenColor: new THREE.Color(colors.treeHighlight), sheenRoughness: 0.65 }, swayTime),
    makeSwayFoliageMaterial({ color: colors.tree, roughness: 0.70, metalness: 0.0, transmission: 0.12, thickness: 0.4, sheen: 0.58, sheenColor: new THREE.Color(colors.treeHighlight), sheenRoughness: 0.6 }, swayTime),
    makeSwayFoliageMaterial({ color: colors.tree, roughness: 0.68, metalness: 0.0, transmission: 0.14, thickness: 0.3, sheen: 0.65, sheenColor: new THREE.Color(colors.treeHighlight) }, swayTime),
  ], [colors, swayTime]);
  useEffect(() => () => { curveFoliageMats.forEach(m => m.dispose()); }, [curveFoliageMats]);
  useAnimationFrame((time) => { swayTime.value = time; });
  
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
  
  const renderElement = (el: typeof landscapeElements.leftElements[0], index: number, side: string, castNearShadow: boolean) => {
    // Distance-based LOD (#105)
    const distToCamera = camera.position.distanceTo(el.position);
    const isNearTree = distToCamera <= 40;
    const isNearBuilding = distToCamera <= 60;

    switch (el.type) {
      case 'tree':
        return (
          <group key={`${side}-tree-${index}`} position={[el.position.x, el.position.y, el.position.z]} rotation={[0, el.rotation, 0]}>
            {/* HD Photorealistic trunk with detailed bark texture simulation */}
            <mesh position={[0, 2 * el.scale, 0]} castShadow={castNearShadow}>
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
            <mesh position={[0, 0.15 * el.scale, 0]} castShadow={castNearShadow}>
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
              <mesh key={j} position={[Math.cos(angle) * 0.5 * el.scale, 0.05, Math.sin(angle) * 0.5 * el.scale]} rotation={[0.3, angle, 0.4]} castShadow={castNearShadow}>
                <cylinderGeometry args={[0.06 * el.scale, 0.1 * el.scale, 0.6 * el.scale, 6]} />
                <meshPhysicalMaterial color={colors.treeBark} roughness={0.98} />
              </mesh>
            ))}
            {/* HD Multi-layer conifer foliage with sway and LOD (#107, #105) */}
            <mesh position={[0, 4.2 * el.scale, 0]} castShadow={castNearShadow}>
              <coneGeometry args={[2.8 * el.scale, 4.8 * el.scale, isNearTree ? 16 : 4]} />
              <primitive object={curveFoliageMats[0]} attach="material" />
            </mesh>
            <mesh position={[0, 5.8 * el.scale, 0]} castShadow={castNearShadow}>
              <coneGeometry args={[2.1 * el.scale, 3.8 * el.scale, isNearTree ? 16 : 4]} />
              <primitive object={curveFoliageMats[1]} attach="material" />
            </mesh>
            <mesh position={[0, 7.0 * el.scale, 0]} castShadow={castNearShadow}>
              <coneGeometry args={[1.4 * el.scale, 3.0 * el.scale, isNearTree ? 14 : 4]} />
              <primitive object={curveFoliageMats[2]} attach="material" />
            </mesh>
            {/* Spire top */}
            <mesh position={[0, 8.0 * el.scale, 0]} castShadow={castNearShadow}>
              <coneGeometry args={[0.6 * el.scale, 2.0 * el.scale, isNearTree ? 12 : 4]} />
              <primitive object={curveFoliageMats[3]} attach="material" />
            </mesh>
          </group>
        );
      case 'mountain':
        return (
          <group key={`${side}-mountain-${index}`} position={[el.position.x, 0, el.position.z]}>
            {/* HD Main mountain with realistic rock surfaces */}
            <mesh position={[0, 8 * el.scale, 0]} castShadow={castNearShadow} receiveShadow>
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
            <mesh position={[0, 14 * el.scale, 0]} castShadow={castNearShadow}>
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
            <mesh position={[3 * el.scale, 5 * el.scale, 2 * el.scale]} castShadow={castNearShadow}>
              <dodecahedronGeometry args={[1.6 * el.scale, 0]} />
              <meshPhysicalMaterial color="#4a5545" roughness={0.95} metalness={0.02} />
            </mesh>
            <mesh position={[-2 * el.scale, 7 * el.scale, 3 * el.scale]} castShadow={castNearShadow}>
              <dodecahedronGeometry args={[1.2 * el.scale, 0]} />
              <meshPhysicalMaterial color="#525a4a" roughness={0.94} metalness={0.02} />
            </mesh>
            <mesh position={[1 * el.scale, 4 * el.scale, -2.5 * el.scale]} castShadow={castNearShadow}>
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
            {/* HD Main building — wall color/roughness from architecture config (#129) */}
            <mesh position={[0, 6 * el.scale, 0]} castShadow={castNearShadow} receiveShadow>
              <boxGeometry args={[4.2 * el.scale, 12.5 * el.scale, 4.2 * el.scale]} />
              <meshPhysicalMaterial 
                color={archConfig.wallMaterial.color}
                roughness={archConfig.wallMaterial.roughness}
                metalness={0.08}
                clearcoat={0.12}
                clearcoatRoughness={0.75}
                sheen={0.1}
                sheenColor={colors.buildingAccent}
              />
            </mesh>
            {/* Roof — style and color from architecture config (#129) */}
            {archConfig.roofStyle === 'pointed' ? (
              <mesh position={[0, 13 * el.scale, 0]} castShadow={castNearShadow}>
                <coneGeometry args={[3 * el.scale, 4 * el.scale, 4]} />
                <meshPhysicalMaterial
                  color={archConfig.roofColor}
                  roughness={0.65}
                  metalness={0.12}
                  clearcoat={0.1}
                />
              </mesh>
            ) : archConfig.roofStyle === 'gabled' ? (
              <mesh position={[0, 13 * el.scale, 0]} castShadow={castNearShadow}>
                <coneGeometry args={[3.5 * el.scale, 3 * el.scale, 3]} />
                <meshPhysicalMaterial
                  color={archConfig.roofColor}
                  roughness={0.7}
                  metalness={0.1}
                />
              </mesh>
            ) : (
              <>
                {/* Flat roof cornice */}
                <mesh position={[0, 12.5 * el.scale, 0]} castShadow={castNearShadow}>
                  <boxGeometry args={[4.5 * el.scale, 0.5 * el.scale, 4.5 * el.scale]} />
                  <meshPhysicalMaterial 
                    color={archConfig.roofColor}
                    roughness={0.78}
                    metalness={0.12}
                    clearcoat={0.08}
                  />
                </mesh>
                <mesh position={[0, 12.8 * el.scale, 0]} castShadow={castNearShadow}>
                  <boxGeometry args={[3.8 * el.scale, 0.3 * el.scale, 3.8 * el.scale]} />
                  <meshPhysicalMaterial color="#2a2a2a" roughness={0.88} metalness={0.1} />
                </mesh>
              </>
            )}
            {/* HD Windows — only rendered when close enough (#105) */}
            {isNearBuilding && [0.22, 0.42, 0.62, 0.82].map((yPos, j) => (
              <React.Fragment key={j}>
                {/* Front windows */}
                <mesh position={[2.12 * el.scale, 12 * el.scale * yPos, 0]} castShadow={castNearShadow}>
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
                <mesh position={[-2.12 * el.scale, 12 * el.scale * yPos, 0]} castShadow={castNearShadow}>
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
            {/* Window frames for detail — only near buildings (#105) */}
            {isNearBuilding && (
            <mesh position={[2.14 * el.scale, 6 * el.scale, 0]} castShadow={castNearShadow}>
              <boxGeometry args={[0.02 * el.scale, 10 * el.scale, 2.8 * el.scale]} />
              <meshPhysicalMaterial color="#1a1a1a" roughness={0.9} metalness={0.15} />
            </mesh>
            )}
          </group>
        );
    }
  };
  
  return (
    <group>
      {filteredLeft.map((el, i) => {
        const elementProgress = i * 0.02 / 0.6;
        const nearShadow = Math.abs(elementProgress - boatProgress) < RENDER_CONFIG.shadowNearProgressBand;
        return renderElement(el, i, 'left', nearShadow);
      })}
      {filteredRight.map((el, i) => {
        const elementProgress = i * 0.02 / 0.6;
        const nearShadow = Math.abs(elementProgress - boatProgress) < RENDER_CONFIG.shadowNearProgressBand;
        return renderElement(el, i, 'right', nearShadow);
      })}
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
  
  // Rock color variations for natural appearance — shared material instances
  const rockBodyMaterials = useMemo(() => [
    new THREE.MeshPhysicalMaterial({ color: '#5a6350', roughness: 0.92, metalness: 0.05, clearcoat: 0.02, clearcoatRoughness: 0.95 }),
    new THREE.MeshPhysicalMaterial({ color: '#6b7260', roughness: 0.92, metalness: 0.05, clearcoat: 0.02, clearcoatRoughness: 0.95 }),
    new THREE.MeshPhysicalMaterial({ color: '#4a5540', roughness: 0.92, metalness: 0.05, clearcoat: 0.02, clearcoatRoughness: 0.95 }),
    new THREE.MeshPhysicalMaterial({ color: '#5e6955', roughness: 0.92, metalness: 0.05, clearcoat: 0.02, clearcoatRoughness: 0.95 }),
  ], []);
  const rockOutcrop1Material = useMemo(() => new THREE.MeshPhysicalMaterial({ color: '#4a5545', roughness: 0.95, metalness: 0.02 }), []);
  const rockOutcrop2Material = useMemo(() => new THREE.MeshPhysicalMaterial({ color: '#555f50', roughness: 0.93, metalness: 0.03 }), []);
  const snowCapMaterial = useMemo(() => new THREE.MeshPhysicalMaterial({ color: '#f8fafc', roughness: 0.4, metalness: 0.0, clearcoat: 0.3, clearcoatRoughness: 0.6, sheen: 0.8, sheenColor: new THREE.Color('#e8f0ff') }), []);
  const snowDetailMaterial = useMemo(() => new THREE.MeshPhysicalMaterial({ color: '#ffffff', roughness: 0.35, clearcoat: 0.4, sheen: 0.7, sheenColor: new THREE.Color('#e0e8ff') }), []);
  const treelineMaterial = useMemo(() => new THREE.MeshPhysicalMaterial({ color: '#2a4a2a', roughness: 0.85, sheen: 0.3, sheenColor: new THREE.Color('#3a5a3a') }), []);

  useEffect(() => {
    return () => {
      rockBodyMaterials.forEach((m) => m.dispose());
      rockOutcrop1Material.dispose();
      rockOutcrop2Material.dispose();
      snowCapMaterial.dispose();
      snowDetailMaterial.dispose();
      treelineMaterial.dispose();
    };
  }, [rockBodyMaterials, rockOutcrop1Material, rockOutcrop2Material, snowCapMaterial, snowDetailMaterial, treelineMaterial]);

  return (
    <group position={[0, 0, boatZ]}>
      {mountains.map((m, i) => {
        const nearShadow = Math.abs(m.z) < RENDER_CONFIG.shadowNearBand;
        return (
        <group key={i} position={[m.x, 0, m.z]}>
          {/* Main mountain body with realistic rock material */}
          <mesh position={[0, m.height / 2 - 2, 0]} castShadow={nearShadow} receiveShadow>
            <coneGeometry args={[m.scale, m.height, 8]} />
            <primitive object={rockBodyMaterials[m.rockVariant]} attach="material" />
          </mesh>
          
          {/* Rocky outcrops for detail */}
          <mesh position={[m.scale * 0.3, m.height * 0.25, m.scale * 0.2]} castShadow={nearShadow}>
            <dodecahedronGeometry args={[m.scale * 0.15, 0]} />
            <primitive object={rockOutcrop1Material} attach="material" />
          </mesh>
          <mesh position={[-m.scale * 0.25, m.height * 0.35, -m.scale * 0.15]} castShadow={nearShadow}>
            <dodecahedronGeometry args={[m.scale * 0.12, 0]} />
            <primitive object={rockOutcrop2Material} attach="material" />
          </mesh>
          
          {/* Snow cap with realistic material */}
          <mesh position={[0, m.height * m.snowLine, 0]} castShadow={nearShadow}>
            <coneGeometry args={[m.scale * (1 - m.snowLine) * 1.1, m.height * (1 - m.snowLine) * 1.2, 8]} />
            <primitive object={snowCapMaterial} attach="material" />
          </mesh>
          
          {/* Snow detail patches */}
          <mesh position={[m.scale * 0.2, m.height * (m.snowLine - 0.1), m.scale * 0.1]} castShadow={nearShadow}>
            <sphereGeometry args={[m.scale * 0.08, 8, 6]} />
            <primitive object={snowDetailMaterial} attach="material" />
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
              castShadow={nearShadow}
            >
              <coneGeometry args={[1.5, 4, 8]} />
              <primitive object={treelineMaterial} attach="material" />
            </mesh>
          ))}
        </group>
        );
      })}
    </group>
  );
};

// ============================================================================
// FOLIAGE SWAY — shared wind-sway vertex shader helper (#107)
// Injects a sinusoidal displacement into cone foliage materials so high-Y
// vertices sway gently in the breeze. All foliage cones share a single
// uTime uniform updated each animation frame.
// ============================================================================
function makeSwayFoliageMaterial(
  params: THREE.MeshPhysicalMaterialParameters,
  uTime: THREE.IUniform<number>,
): THREE.MeshPhysicalMaterial {
  const mat = new THREE.MeshPhysicalMaterial(params);
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uTime;
    shader.vertexShader = 'uniform float uTime;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
float swayAmt = sin(uTime * 1.2 + position.x * 0.5) * 0.04 * max(0.0, position.y / 5.0);
transformed.x += swayAmt;
transformed.z += swayAmt * 0.7;`,
    );
  };
  return mat;
}

// ============================================================================
// PINE TREES - Scattered along the banks
// ============================================================================
const PineTrees: React.FC<{ side: 'left' | 'right'; boatZ: number; theme?: RouteTheme }> = ({ side, boatZ, theme = 'willowbrook' }) => {
  const xBase = side === 'left' ? -25 : 25;

  // Per-theme tree species config (#128)
  const speciesList = useMemo(() => getThemeConfig(theme).trees.species, [theme]);

  // Generate tree positions with species-based variety (#128)
  const trees = useMemo(() => {
    const result: Array<{ x: number; z: number; scale: number; variant: number; rotation: number; isNear: boolean; species: TreeSpeciesEntry }> = [];
    for (let z = -400; z < 400; z += 8) {
      const treeIdx = Math.round((z + 400) / 8);
      const count = 1 + Math.floor(seededRandom(treeIdx * 9 + 1) * 2);
      for (let j = 0; j < count; j++) {
        const speciesIdx = Math.floor(seededRandom(treeIdx * 9 + j * 4 + 7) * speciesList.length);
        const sp = speciesList[speciesIdx];
        result.push({
          x: xBase + (seededRandom(treeIdx * 9 + j * 4 + 2) - 0.5) * 15 + (side === 'left' ? -5 : 5),
          z: z + (seededRandom(treeIdx * 9 + j * 4 + 3) - 0.5) * 6,
          scale: 0.8 + seededRandom(treeIdx * 9 + j * 4 + 4) * 0.6,
          variant: Math.floor(seededRandom(treeIdx * 9 + j * 4 + 5) * 3),
          rotation: seededRandom(treeIdx * 9 + j * 4 + 6) * Math.PI * 2,
          isNear: Math.abs(z) <= 40,
          species: sp,
        });
      }
    }
    return result;
  }, [xBase, side, speciesList]);

  // Sway time uniform — shared across all foliage materials (#107)
  const swayTime = useMemo<THREE.IUniform<number>>(() => ({ value: 0 }), []);

  // Foliage materials with wind-sway vertex shader — use primary species color (#128)
  const primaryColor = speciesList[0]?.color ?? '#1a4020';
  const foliageMats = useMemo(() => [
    makeSwayFoliageMaterial({ color: primaryColor, roughness: 0.85, metalness: 0.0, transmission: 0.05, thickness: 0.5, sheen: 0.3, sheenColor: new THREE.Color(primaryColor) }, swayTime),
    makeSwayFoliageMaterial({ color: primaryColor, roughness: 0.80, metalness: 0.0, transmission: 0.08, thickness: 0.4, sheen: 0.4, sheenColor: new THREE.Color(primaryColor) }, swayTime),
    makeSwayFoliageMaterial({ color: primaryColor, roughness: 0.75, metalness: 0.0, transmission: 0.10, thickness: 0.3, sheen: 0.5, sheenColor: new THREE.Color(primaryColor) }, swayTime),
    makeSwayFoliageMaterial({ color: primaryColor, roughness: 0.70, metalness: 0.0, transmission: 0.12, thickness: 0.2, sheen: 0.6, sheenColor: new THREE.Color(primaryColor) }, swayTime),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [swayTime, primaryColor]);

  useEffect(() => () => { foliageMats.forEach(m => m.dispose()); }, [foliageMats]);

  // Drive uTime each frame so sway animates
  useAnimationFrame((time) => { swayTime.value = time; });

  // Instanced mesh refs — one per foliage cone layer (#102)
  const cone0Ref = useRef<THREE.InstancedMesh>(null);
  const cone1Ref = useRef<THREE.InstancedMesh>(null);
  const cone2Ref = useRef<THREE.InstancedMesh>(null);
  const cone3Ref = useRef<THREE.InstancedMesh>(null);

  // Layer config: [yOffset, radius, height] — matches original per-tree cone positions
  const CONE_LAYERS = [
    [2.8, 1.4, 2.2],
    [3.8, 1.1, 2.0],
    [4.6, 0.8, 1.8],
    [5.3, 0.4, 1.2],
  ] as const;

  // Set instance matrices whenever the tree list changes
  useEffect(() => {
    const refs = [cone0Ref, cone1Ref, cone2Ref, cone3Ref];
    const dummy = new THREE.Object3D();
    refs.forEach((ref, layer) => {
      if (!ref.current) return;
      const yOffset = CONE_LAYERS[layer][0];
      trees.forEach((tree, i) => {
        dummy.position.set(tree.x, yOffset * tree.scale, tree.z);
        dummy.scale.setScalar(tree.scale);
        dummy.rotation.set(0, tree.rotation, 0);
        dummy.updateMatrix();
        ref.current!.setMatrixAt(i, dummy.matrix);
      });
      ref.current.instanceMatrix.needsUpdate = true;
    });
  // CONE_LAYERS is a constant tuple; trees and foliageMats are the real deps
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trees]);
  
  return (
    <group position={[0, 0, boatZ]}>
      {/* Per-tree trunks, bark rings, root flares, and branch variants */}
      {trees.map((tree, i) => {
        const nearShadow = Math.abs(tree.z) < RENDER_CONFIG.shadowNearBand;
        const trunkColor = tree.species.trunkColor;
        const isBare = tree.species.type === 'bare';
        return (
        <group key={i} position={[tree.x, 0, tree.z]} scale={tree.scale} rotation={[0, tree.rotation, 0]}>
          {/* Tree trunk — color from species config (#128) */}
          <mesh position={[0, 1.2, 0]} castShadow={nearShadow}>
            <cylinderGeometry args={[0.12, 0.22, 2.4, 12]} />
            <meshPhysicalMaterial 
              color={trunkColor}
              roughness={0.95}
              metalness={0.0}
              clearcoat={0.05}
              clearcoatRoughness={0.9}
            />
          </mesh>
          {/* Bark detail rings */}
          {[0.4, 0.8, 1.2, 1.6].map((y, j) => (
            <mesh key={j} position={[0, y, 0]} castShadow={nearShadow}>
              <torusGeometry args={[0.16 + (2.4 - y) * 0.02, 0.02, 6, 12]} />
              <meshStandardMaterial color={trunkColor} roughness={1.0} />
            </mesh>
          ))}
          {/* Root flare at base */}
          <mesh position={[0, 0.1, 0]} castShadow={nearShadow}>
            <cylinderGeometry args={[0.22, 0.35, 0.3, 8]} />
            <meshPhysicalMaterial color={trunkColor} roughness={0.95} />
          </mesh>
          {/* Bare/dead trees: extra dead branch stumps instead of foliage branches */}
          {isBare && tree.variant === 0 && (
            <>
              <mesh position={[0.3, 2.5, 0.2]} rotation={[0, 0, 0.6]} castShadow={nearShadow}>
                <cylinderGeometry args={[0.02, 0.04, 0.5, 5]} />
                <meshStandardMaterial color={trunkColor} roughness={1.0} />
              </mesh>
              <mesh position={[-0.25, 2.8, -0.15]} rotation={[0, 0, -0.5]} castShadow={nearShadow}>
                <cylinderGeometry args={[0.015, 0.03, 0.4, 5]} />
                <meshStandardMaterial color={trunkColor} roughness={1.0} />
              </mesh>
            </>
          )}
          {/* Normal branch details for non-bare trees */}
          {!isBare && tree.variant === 0 && (
            <>
              <mesh position={[0.3, 2.5, 0.2]} rotation={[0, 0, 0.4]} castShadow={nearShadow}>
                <cylinderGeometry args={[0.03, 0.05, 0.6, 6]} />
                <meshStandardMaterial color={trunkColor} roughness={0.9} />
              </mesh>
              <mesh position={[-0.25, 2.8, -0.15]} rotation={[0, 0, -0.3]} castShadow={nearShadow}>
                <cylinderGeometry args={[0.025, 0.04, 0.5, 6]} />
                <meshStandardMaterial color={trunkColor} roughness={0.9} />
              </mesh>
            </>
          )}
        </group>
        );
      })}

      {/* Instanced foliage cone layers — skip for bare species (#128).
          frustumCulled=false avoids incorrect culling when the bounding box
          is not explicitly recomputed after matrix updates. */}
      {speciesList[0]?.type !== 'bare' && (<>
      <instancedMesh ref={cone0Ref} args={[undefined, undefined, trees.length]} frustumCulled={false}>
        <coneGeometry args={[CONE_LAYERS[0][1], CONE_LAYERS[0][2], 8]} />
        <primitive object={foliageMats[0]} attach="material" />
      </instancedMesh>
      <instancedMesh ref={cone1Ref} args={[undefined, undefined, trees.length]} frustumCulled={false}>
        <coneGeometry args={[CONE_LAYERS[1][1], CONE_LAYERS[1][2], 8]} />
        <primitive object={foliageMats[1]} attach="material" />
      </instancedMesh>
      <instancedMesh ref={cone2Ref} args={[undefined, undefined, trees.length]} frustumCulled={false}>
        <coneGeometry args={[CONE_LAYERS[2][1], CONE_LAYERS[2][2], 8]} />
        <primitive object={foliageMats[2]} attach="material" />
      </instancedMesh>
      <instancedMesh ref={cone3Ref} args={[undefined, undefined, trees.length]} frustumCulled={false}>
        <coneGeometry args={[CONE_LAYERS[3][1], CONE_LAYERS[3][2], 6]} />
        <primitive object={foliageMats[3]} attach="material" />
      </instancedMesh>
      </>)}
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
          <mesh position={[0, c.height / 2, 0]} castShadow={Math.abs(c.z) < RENDER_CONFIG.shadowNearBand}>
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
          <mesh position={[0, c.height / 2, 0]} castShadow={Math.abs(c.z) < RENDER_CONFIG.shadowNearBand}>
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
          <mesh position={[0, m.height / 2 - 2, 0]} castShadow={Math.abs(m.z) < RENDER_CONFIG.shadowNearBand} receiveShadow>
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
          <mesh position={[m.scale * 0.35, m.height * 0.3, m.scale * 0.2]} castShadow={Math.abs(m.z) < RENDER_CONFIG.shadowNearBand}>
            <dodecahedronGeometry args={[m.scale * 0.12, 0]} />
            <meshPhysicalMaterial color="#4a5560" roughness={0.94} />
          </mesh>
          {/* Realistic snow cap */}
          <mesh position={[0, m.height * m.snowAmount, 0]} castShadow={Math.abs(m.z) < RENDER_CONFIG.shadowNearBand}>
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
          <mesh position={[m.scale * 0.25, m.height * (m.snowAmount - 0.12), m.scale * 0.15]} castShadow={Math.abs(m.z) < RENDER_CONFIG.shadowNearBand}>
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
          <mesh position={[0, b.height / 2, 0]} castShadow={Math.abs(b.z) < RENDER_CONFIG.shadowNearBand} receiveShadow>
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
          <mesh position={[0, b.height * 0.95, 0]} castShadow={Math.abs(b.z) < RENDER_CONFIG.shadowNearBand}>
            <boxGeometry args={[b.width + 0.3, 0.4, b.depth + 0.3]} />
            <meshPhysicalMaterial color="#3d4a50" roughness={0.88} metalness={0.03} />
          </mesh>
          <mesh position={[0, b.height * 0.6, 0]} castShadow={Math.abs(b.z) < RENDER_CONFIG.shadowNearBand}>
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
          <mesh position={[b.debrisOffset * b.width * 0.3, b.height + 0.5, 0]} castShadow={Math.abs(b.z) < RENDER_CONFIG.shadowNearBand}>
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
              <mesh position={[0, s.height / 2, 0]} castShadow={Math.abs(s.z) < RENDER_CONFIG.shadowNearBand} receiveShadow>
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
              <mesh position={[0, s.height * 0.3, 0]} castShadow={Math.abs(s.z) < RENDER_CONFIG.shadowNearBand} receiveShadow>
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
            <mesh position={[0, actualHeight / 2, 0]} castShadow={Math.abs(r.z) < RENDER_CONFIG.shadowNearBand} receiveShadow>
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
                <mesh position={[0, s.height / 2, 0]} castShadow={Math.abs(s.z) < RENDER_CONFIG.shadowNearBand}>
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
// HD PHOTOREALISTIC SKYDOME - Enhanced sky with volumetric clouds and HDR lighting
// ============================================================================
const PhotorealisticSkydome: React.FC<{ theme: RouteTheme; boatZ: number }> = ({ theme, boatZ }) => {
  const skyConfig = useMemo(() => getThemeConfig(theme).sky, [theme]);
  const cloudConfig = useMemo(() => getThemeConfig(theme).clouds, [theme]);
  
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
  
  useAnimationFrame((time) => {
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
// CAUSTICS LIGHT — animated SpotLight with caustics cookie texture (#123)
// Only rendered on performanceMode !== 'low'.
// ============================================================================
const CausticsLight: React.FC<{ boatZ: number }> = ({ boatZ }) => {
  const spotRef = useRef<THREE.SpotLight>(null);
  const targetRef = useRef<THREE.Object3D>(null);
  const cookieRef = useRef<THREE.CanvasTexture | null>(null);

  const causticsTexture = useMemo(() => {
    const tex = createCausticsTexture();
    cookieRef.current = tex;
    return tex;
  }, []);
  useEffect(() => () => { causticsTexture.dispose(); }, [causticsTexture]);

  useAnimationFrame((time) => {
    if (spotRef.current) {
      // Slowly orbit the light for animated caustics shimmer
      const r = 2.0;
      spotRef.current.position.x = Math.sin(time * 0.4) * r;
      spotRef.current.position.z = boatZ + Math.cos(time * 0.4) * r;
    }
    // Scroll texture UV offset for animated caustics pattern
    if (causticsTexture) {
      causticsTexture.offset.x = (time * 0.03) % 1;
      causticsTexture.offset.y = (time * 0.02) % 1;
      causticsTexture.needsUpdate = true;
    }
  });

  return (
    <>
      <object3D ref={targetRef} position={[0, 0, boatZ]} />
      <spotLight
        ref={spotRef}
        position={[0, 8, boatZ]}
        color="#b0d8ff"
        intensity={0.6}
        angle={0.5}
        penumbra={0.4}
        distance={20}
        castShadow={false}
        map={causticsTexture}
        target={targetRef.current ?? undefined}
      />
    </>
  );
};

// ============================================================================
// GROUND COVER — instanced reeds, rocks, and grass along the banks (#130)
// Only rendered on performanceMode !== 'low'.
// ============================================================================
const GroundCover: React.FC<{ boatZ: number; theme: RouteTheme; performanceMode?: PerformanceMode }> = ({ boatZ, theme }) => {
  const gcConfig = useMemo(() => getThemeConfig(theme).groundCover, [theme]);

  const reedEntry  = useMemo(() => gcConfig.types.find(t => t.type === 'reed'),  [gcConfig]);
  const rockEntry  = useMemo(() => gcConfig.types.find(t => t.type === 'rock'),  [gcConfig]);
  const grassEntry = useMemo(() => gcConfig.types.find(t => t.type === 'grass' || t.type === 'flower'), [gcConfig]);

  const reedMeshRef  = useRef<THREE.InstancedMesh>(null);
  const rockMeshRef  = useRef<THREE.InstancedMesh>(null);
  const grassMeshRef = useRef<THREE.InstancedMesh>(null);

  const REED_COUNT  = 120;
  const ROCK_COUNT  = 40;
  const GRASS_COUNT = 80;

  // Reed material
  const reedMat = useMemo(() => new THREE.MeshPhysicalMaterial({
    color: reedEntry?.color ?? '#8a7a50',
    roughness: 0.85,
    metalness: 0.0,
    side: THREE.DoubleSide,
  }), [reedEntry]);
  useEffect(() => () => { reedMat.dispose(); }, [reedMat]);

  // Rock material
  const rockMat = useMemo(() => new THREE.MeshPhysicalMaterial({
    color: rockEntry?.color ?? '#666666',
    roughness: 0.9,
    metalness: 0.05,
  }), [rockEntry]);
  useEffect(() => () => { rockMat.dispose(); }, [rockMat]);

  // Grass material
  const grassMat = useMemo(() => new THREE.MeshPhysicalMaterial({
    color: grassEntry?.color ?? '#4a7a40',
    roughness: 0.8,
    metalness: 0.0,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.9,
  }), [grassEntry]);
  useEffect(() => () => { grassMat.dispose(); }, [grassMat]);

  // Populate instance matrices
  useEffect(() => {
    const dummy = new THREE.Object3D();

    if (reedMeshRef.current && reedEntry) {
      for (let i = 0; i < REED_COUNT; i++) {
        const side = seededRandom(i * 7 + 0) > 0.5 ? 1 : -1;
        const x = side * (8 + seededRandom(i * 7 + 1) * 8);
        const z = (seededRandom(i * 7 + 2) - 0.5) * 400;
        const s = (reedEntry.scale ?? 1) * (0.8 + seededRandom(i * 7 + 3) * 0.4);
        dummy.position.set(x, 0.75 * s, z);
        dummy.scale.set(s, s, s);
        dummy.rotation.set(0, seededRandom(i * 7 + 4) * Math.PI * 2, 0);
        dummy.updateMatrix();
        reedMeshRef.current.setMatrixAt(i, dummy.matrix);
      }
      reedMeshRef.current.instanceMatrix.needsUpdate = true;
    }

    if (rockMeshRef.current && rockEntry) {
      for (let i = 0; i < ROCK_COUNT; i++) {
        const side = seededRandom(i * 11 + 0) > 0.5 ? 1 : -1;
        const x = side * (7 + seededRandom(i * 11 + 1) * 10);
        const z = (seededRandom(i * 11 + 2) - 0.5) * 400;
        const s = (rockEntry.scale ?? 1) * (0.3 + seededRandom(i * 11 + 3) * 0.5);
        dummy.position.set(x, s * 0.5, z);
        dummy.scale.set(s * (0.8 + seededRandom(i * 11 + 4) * 0.4), s, s * (0.8 + seededRandom(i * 11 + 5) * 0.4));
        dummy.rotation.set(seededRandom(i * 11 + 6) * 0.5, seededRandom(i * 11 + 7) * Math.PI * 2, seededRandom(i * 11 + 8) * 0.3);
        dummy.updateMatrix();
        rockMeshRef.current.setMatrixAt(i, dummy.matrix);
      }
      rockMeshRef.current.instanceMatrix.needsUpdate = true;
    }

    if (grassMeshRef.current && grassEntry) {
      for (let i = 0; i < GRASS_COUNT; i++) {
        const side = seededRandom(i * 5 + 0) > 0.5 ? 1 : -1;
        const x = side * (7 + seededRandom(i * 5 + 1) * 10);
        const z = (seededRandom(i * 5 + 2) - 0.5) * 400;
        const s = (grassEntry.scale ?? 1) * (0.5 + seededRandom(i * 5 + 3) * 0.4);
        dummy.position.set(x, 0.3 * s, z);
        dummy.scale.setScalar(s);
        dummy.rotation.set(0, seededRandom(i * 5 + 4) * Math.PI * 2, 0);
        dummy.updateMatrix();
        grassMeshRef.current.setMatrixAt(i, dummy.matrix);
      }
      grassMeshRef.current.instanceMatrix.needsUpdate = true;
    }
  }, [theme, reedEntry, rockEntry, grassEntry]);

  return (
    <group position={[0, 0, boatZ]}>
      {reedEntry && (
        <instancedMesh ref={reedMeshRef} args={[undefined, undefined, REED_COUNT]} frustumCulled={false}>
          <cylinderGeometry args={[0.05, 0.05, 1.5, 4]} />
          <primitive object={reedMat} attach="material" />
        </instancedMesh>
      )}
      {rockEntry && (
        <instancedMesh ref={rockMeshRef} args={[undefined, undefined, ROCK_COUNT]} frustumCulled={false}>
          <sphereGeometry args={[1, 5, 4]} />
          <primitive object={rockMat} attach="material" />
        </instancedMesh>
      )}
      {grassEntry && (
        <instancedMesh ref={grassMeshRef} args={[undefined, undefined, GRASS_COUNT]} frustumCulled={false}>
          <planeGeometry args={[0.6, 0.6]} />
          <primitive object={grassMat} attach="material" />
        </instancedMesh>
      )}
    </group>
  );
};

// ============================================================================
// HORIZON SILHOUETTE — distant silhouette per theme using THREE.Shape (#131)
// ============================================================================
const HorizonSilhouette: React.FC<{ boatZ: number; theme: RouteTheme }> = ({ boatZ, theme }) => {
  const horizonConfig = useMemo(() => getThemeConfig(theme).horizon, [theme]);

  const silhouetteGeo = useMemo(() => {
    const shape = new THREE.Shape();
    const width = 300;
    const segments = 60;

    shape.moveTo(-width / 2, 0);

    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const x = -width / 2 + t * width;
      let y = 0;

      switch (horizonConfig.type) {
        case 'mountains': {
          // Multi-peak mountain profile
          y = Math.max(0,
            seededRandom(i * 3 + 1) * 0.4 * horizonConfig.height
            + Math.sin(t * Math.PI * 4) * 0.5 * horizonConfig.height
            + Math.sin(t * Math.PI * 7 + 1.2) * 0.3 * horizonConfig.height
          );
          break;
        }
        case 'city': {
          // Rectangular city skyline
          const buildingIdx = Math.floor(t * 20);
          const buildingH = seededRandom(buildingIdx * 5 + 2) * horizonConfig.height;
          y = buildingH;
          break;
        }
        case 'hills': {
          // Rolling hills/tree-line
          y = Math.max(0,
            horizonConfig.height * 0.5
            + Math.sin(t * Math.PI * 10) * horizonConfig.height * 0.3
            + seededRandom(i * 3 + 3) * horizonConfig.height * 0.2
          );
          break;
        }
        case 'industrial': {
          // Blocky factory shapes with chimneys
          const segIdx = Math.floor(t * 15);
          const isChimney = seededRandom(segIdx * 7 + 4) > 0.75;
          y = isChimney
            ? horizonConfig.height * (0.6 + seededRandom(segIdx * 7 + 5) * 0.6)
            : seededRandom(segIdx * 7 + 6) * horizonConfig.height * 0.5;
          break;
        }
        case 'islands': {
          // Low island archipelago silhouette
          const islandIdx = Math.floor(t * 8);
          const isIsland = seededRandom(islandIdx * 9 + 7) > 0.4;
          y = isIsland
            ? horizonConfig.height * (0.2 + seededRandom(islandIdx * 9 + 8) * 0.5)
            : 0;
          break;
        }
        default:
          y = horizonConfig.height * 0.15;
          break;
      }

      shape.lineTo(x, y);
    }

    shape.lineTo(width / 2, 0);
    shape.closePath();

    return new THREE.ShapeGeometry(shape);
  }, [horizonConfig]);

  useEffect(() => () => { silhouetteGeo.dispose(); }, [silhouetteGeo]);

  const silhouetteMat = useMemo(() => new THREE.MeshBasicMaterial({
    color: horizonConfig.color,
    side: THREE.FrontSide,
    transparent: true,
    opacity: 0.85,
  }), [horizonConfig.color]);
  useEffect(() => () => { silhouetteMat.dispose(); }, [silhouetteMat]);

  return (
    <group position={[0, 0, boatZ - horizonConfig.distance]}>
      <mesh geometry={silhouetteGeo} material={silhouetteMat} />
    </group>
  );
};


const OarRig: React.FC<{ side: 'left' | 'right' }> = ({ side }) => {
  const sx = side === 'left' ? -1 : 1;
  return (
    <>
      {/* HD Rigger - aerospace aluminum outrigger */}
      <mesh position={[sx * 0.6, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.028, 0.028, 1.2, 16]} />
        <meshPhysicalMaterial color="#9a9a9a" metalness={0.95} roughness={0.08} clearcoat={0.75} clearcoatRoughness={0.12} reflectivity={0.9} />
      </mesh>
      {/* Rigger support strut */}
      <mesh position={[sx * 0.3, -0.08, 0]} rotation={[0, 0, sx * -0.4]}>
        <cylinderGeometry args={[0.012, 0.012, 0.35, 12]} />
        <meshPhysicalMaterial color="#8a8a8a" metalness={0.92} roughness={0.1} />
      </mesh>
      {/* HD Oarlock - precision stainless steel */}
      <mesh position={[sx * 1.15, 0, 0]}>
        <torusGeometry args={[0.045, 0.018, 12, 20]} />
        <meshPhysicalMaterial color="#b8b8b8" metalness={0.98} roughness={0.06} clearcoat={0.85} clearcoatRoughness={0.08} reflectivity={0.95} />
      </mesh>
      {/* HD Oar shaft - premium carbon fiber */}
      <mesh position={[sx * 1.8, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.022, 0.028, 2.8, 16]} />
        <meshPhysicalMaterial color="#c0a060" metalness={0.1} roughness={0.15} clearcoat={0.6} clearcoatRoughness={0.2} sheen={0.2} sheenColor="#d0b070" />
      </mesh>
      {/* Grip area */}
      <mesh position={[sx * 0.35, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.032, 0.032, 0.3, 16]} />
        <meshPhysicalMaterial color="#1a1a1a" roughness={0.85} metalness={0.0} />
      </mesh>
      {/* HD Oar blade - competition composite with team colors */}
      <mesh position={[sx * 3.3, 0, 0]}>
        <boxGeometry args={[0.58, 0.018, 0.2]} />
        <meshPhysicalMaterial color="#1a3c6b" metalness={0} roughness={0.4} clearcoat={0.5} clearcoatRoughness={0.2} sheen={0.2} sheenColor="#2a5080" />
      </mesh>
      {/* Blade edge detail */}
      <mesh position={[sx * 3.55, 0, 0]}>
        <boxGeometry args={[0.08, 0.016, 0.19]} />
        <meshPhysicalMaterial color="#0f2460" roughness={0.4} metalness={0} clearcoat={0.5} />
      </mesh>
    </>
  );
};

// ============================================================================
// HIGH-DEFINITION ROWING SCULL (BOAT) with animated oars and realistic rower
// ============================================================================
// This is the always-on HD implementation with realistic proportions and PBR materials.
// Based on modern racing single scull dimensions (~8.2m length, ~0.3m beam).
// All animation refs preserved for seamless gameplay integration.

const RowingScullBase: React.FC<{ cadence: number; strokeCycleTRef?: React.MutableRefObject<number> }> = ({ cadence, strokeCycleTRef }) => {
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
    // Use shared strokeCycleT from physics engine when available; fall back to
    // an independent clock so the animation still runs without a parent hook.
    const phase = strokeCycleTRef ? strokeCycleTRef.current : (time * freqHz % 1);
    
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

  // Procedural normal map for hull surface grain (#116)
  const hullNormalMap = useMemo(() => createBoatNormalMap(), []);
  useEffect(() => () => hullNormalMap.dispose(), [hullNormalMap]);
  
  return (
    <group>
      {/* HD Main hull - racing shell with PBR fiberglass finish (#116) */}
      <mesh castShadow>
        <boxGeometry args={[0.45, 0.15, 8]} />
        <meshPhysicalMaterial 
          color="#e8e4d8"           // Fibreglass white
          metalness={0.0}
          roughness={0.2}
          clearcoat={0.8}
          clearcoatRoughness={0.1}
          reflectivity={0.95}
          envMapIntensity={1.5}
          sheen={0.4}
          sheenColor="#fffef0"
          sheenRoughness={0.2}
          ior={1.45}
          normalMap={hullNormalMap}
          normalScale={new THREE.Vector2(0.3, 0.3)}
        />
      </mesh>
      
      {/* HD Hull deck with visible grain pattern simulation */}
      <mesh position={[0, 0.08, 0]} castShadow>
        <boxGeometry args={[0.4, 0.02, 7.5]} />
        <meshPhysicalMaterial 
          color="#f0ecdE" 
          metalness={0.0} 
          roughness={0.22}
          clearcoat={0.8}
          clearcoatRoughness={0.1}
          sheen={0.25}
          sheenColor="#ffffff"
        />
      </mesh>
      
      {/* HD Bow (front) - aerodynamic point */}
      <mesh position={[0, 0, -4.2]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <coneGeometry args={[0.22, 1.0, 16]} />
        <meshPhysicalMaterial 
          color="#e8e4d8" 
          metalness={0.0} 
          roughness={0.2}
          clearcoat={0.8}
          clearcoatRoughness={0.1}
          reflectivity={0.95}
          sheen={0.4}
          sheenColor="#fffef0"
        />
      </mesh>
      
      {/* HD Stern (back) - tapered stern with racing graphics */}
      <mesh position={[0, 0, 4]} rotation={[-Math.PI / 2, 0, 0]} castShadow>
        <coneGeometry args={[0.2, 0.8, 16]} />
        <meshPhysicalMaterial 
          color="#e8e4d8" 
          metalness={0.0} 
          roughness={0.2}
          clearcoat={0.8}
          clearcoatRoughness={0.1}
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
        <OarRig side="left" />
      </group>
      
      {/* HD Right oar group - professional racing equipment */}
      <group ref={rightOarRef} position={[0.3, 0.15, 0.5]}>
        <OarRig side="right" />
      </group>
    </group>
  );
};

// Memoize so the boat only re-renders when cadence changes.
// Position and rotation are driven imperatively — either via a parent group ref
// (Playwright mode) or via a Rapier kinematic body (normal mode).
// strokeCycleTRef is a stable ref object so its identity never changes; the memo
// comparison below therefore never needs to check it.
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
      <RowingScull cadence={cadence} strokeCycleTRef={strokeCycleTRef} />
    </RigidBody>
  );
};

// ============================================================================
// DYNAMIC POST-PROCESSING — velocity-gated chromatic aberration + depth-of-field
// + bloom, vignette, ACES filmic tone mapping. Runs inside the R3F canvas so
// it can access useFrame for per-frame effect updates without React state churn.
// ============================================================================
const DynamicPostFx: React.FC<{
  velocityRef: React.MutableRefObject<number>;
  performanceMode?: PerformanceMode;
  theme: RouteTheme;
  sunMeshRef?: React.RefObject<THREE.Mesh>;
}> = ({ velocityRef, performanceMode, theme, sunMeshRef }) => {
  // Create ChromaticAberrationEffect directly (not via the @react-three/postprocessing P-wrapper)
  // to avoid React 19's ref-as-prop behaviour causing JSON.stringify on the circular __r3f instance.
  const caEffect = useMemo(() => new ChromaticAberrationEffect({ offset: new THREE.Vector2(0, 0), radialModulation: false, modulationOffset: 0 }), []);
  useEffect(() => () => caEffect.dispose(), [caEffect]);

  // Per-theme color grading values from themeConfig (#124)
  const colorGrading: ColorGradingConfig = useMemo(() => getThemeConfig(theme).colorGrading, [theme]);

  // Scale chromatic aberration with boat speed: silent at rest, subtle at sprint pace
  useFrame(({ gl }) => {
    const vel = velocityRef.current;
    const aberration = Math.min(vel / 8.0, 1.0) * 0.0018;
    caEffect.offset.set(aberration, aberration * 0.6);

    // Adaptive eye-adaptation: slowly lerp toneMappingExposure toward target (#125)
    const targetExposure = vel > 3 ? 0.85 : 1.0;
    gl.toneMappingExposure = THREE.MathUtils.lerp(gl.toneMappingExposure, targetExposure, 0.015);
  });

  // In auto mode skip the expensive DepthOfField pass
  if (performanceMode === 'auto') {
    return (
      <EffectComposer enableNormalPass>
        <SSAO samples={16} rings={3} distanceThreshold={1.0} distanceFalloff={0.1} rangeThreshold={0.5} rangeFalloff={0.1} luminanceInfluence={0.9} radius={10} bias={0.5} intensity={0.8} />
        <Bloom intensity={0.28} luminanceThreshold={0.72} luminanceSmoothing={0.85} />
        <primitive object={caEffect} />
        {/* Per-theme colour grading — HueSaturation + BrightnessContrast (#124) */}
        <HueSaturation hue={colorGrading.hue} saturation={colorGrading.saturation} />
        <BrightnessContrast brightness={colorGrading.brightness} contrast={colorGrading.contrast} />
        <Vignette eskil={false} offset={0.3} darkness={0.5} />
        <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
      </EffectComposer>
    );
  }

  // High mode with GodRays — only when sun mesh ref is provided (#120)
  if (sunMeshRef) {
    return (
      <EffectComposer enableNormalPass>
        <SSAO samples={24} rings={4} distanceThreshold={1.0} distanceFalloff={0.1} rangeThreshold={0.5} rangeFalloff={0.1} luminanceInfluence={0.9} radius={15} bias={0.5} intensity={1.0} />
        <Bloom intensity={0.28} luminanceThreshold={0.72} luminanceSmoothing={0.85} />
        <primitive object={caEffect} />
        <DepthOfField worldFocusDistance={10} worldFocusRange={25} bokehScale={2} height={480} />
        <HueSaturation hue={colorGrading.hue} saturation={colorGrading.saturation} />
        <BrightnessContrast brightness={colorGrading.brightness} contrast={colorGrading.contrast} />
        <GodRays sun={sunMeshRef} exposure={0.34} decay={0.85} density={0.85} weight={0.4} samples={60} />
        <Vignette eskil={false} offset={0.3} darkness={0.5} />
        <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
      </EffectComposer>
    );
  }

  // High mode without GodRays (test mode or sun mesh not yet mounted)
  return (
    <EffectComposer enableNormalPass>
      <SSAO samples={24} rings={4} distanceThreshold={1.0} distanceFalloff={0.1} rangeThreshold={0.5} rangeFalloff={0.1} luminanceInfluence={0.9} radius={15} bias={0.5} intensity={1.0} />
      <Bloom intensity={0.28} luminanceThreshold={0.72} luminanceSmoothing={0.85} />
      <primitive object={caEffect} />
      <DepthOfField worldFocusDistance={10} worldFocusRange={25} bokehScale={2} height={480} />
      <HueSaturation hue={colorGrading.hue} saturation={colorGrading.saturation} />
      <BrightnessContrast brightness={colorGrading.brightness} contrast={colorGrading.contrast} />
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
  performanceMode = 'auto',
}) => {
  const { camera } = useThree();
  
  // Detect route theme for landscape selection
  const routeTheme = useMemo(() => detectRouteTheme(route), [route]);
  const themeConfig = useMemo(() => getThemeConfig(routeTheme), [routeTheme]);
  // Compute route-specific landmark config (null when no matching route)
  const landmarkConfig = useMemo(
    () => getRouteLandmarkConfig(route?.name, route?.tags),
    [route?.name, route?.tags],
  );
  
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
  const { boatStateRef, strokePhase, dispatchTick } = usePhysicsEngine();

  // Expose stroke phase and velocity via refs for child components (avoids re-renders)
  const strokeCycleTRef = useRef(0);
  const velocityRef = useRef(0);

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
    velocityRef.current = boatStateRef.current.smoothedVelocityMps || speedMps;
    strokeCycleTRef.current = boatStateRef.current.strokeCycleT;
    
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
        window.__ROWER3D_STROKE_PHASE = boatStateRef.current.strokePhase;
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
            <PineTrees side="left" boatZ={boatZ} theme={routeTheme} />
            <PineTrees side="right" boatZ={boatZ} theme={routeTheme} />
          </>
        );
    }
  };

  // Compute sun position from per-theme elevation/azimuth (#126)
  // Formula: [cos(elev)*sin(az), sin(elev), cos(elev)*cos(az)] × 200
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

  // Ref for sun mesh passed to GodRays (#120)
  const sunMeshRef = useRef<THREE.Mesh>(null!);
  // Ref guards sunMeshRef so GodRays only receives it in high mode
  const godRaysSunRef = performanceMode === 'high' ? sunMeshRef : undefined;

  return (
    <AnimationProvider>
      {/* Exponential fog — per-theme density/colour from themeConfig (#108) */}
      <fogExp2 attach="fog" args={[themeConfig.fog.color, themeConfig.fog.density]} />
      
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
      
      {/* Primary sunlight — position derived from per-theme sunElevation/sunAzimuth (#126)
          Shadow quality scales with performanceMode: 2048 high, 1024 auto, none low (#118) */}
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
      
      {/* Ambient fill — colour/intensity from themeConfig (#108, #126) */}
      <ambientLight 
        intensity={themeConfig.lighting.ambientIntensity}
        color={themeConfig.lighting.ambientColor}
      />
      
      {/* Fill light from opposite side — colour/intensity from themeConfig (#108) */}
      <directionalLight
        position={[-sunLightPos[0] * 0.6, 50, -sunLightPos[2] * 0.5]}
        intensity={themeConfig.lighting.fillIntensity}
        color={themeConfig.lighting.fillColor}
      />

      {/* Sun mesh for GodRays — small bright sphere placed at sun position (#120).
          Visible only in high mode; frustumCulled=false prevents early clip-out. */}
      {!IS_TEST_MODE && performanceMode === 'high' && (
        <mesh ref={sunMeshRef} position={sunLightPos} frustumCulled={false}>
          <sphereGeometry args={[5, 8, 8]} />
          <meshBasicMaterial color={themeConfig.lighting.sunColor} />
        </mesh>
      )}
      
      {/* PMREM environment generated from the procedural skydome — #121 */}
      <PMREMEnvironment theme={routeTheme} />
      
      {/* Water - curved if we have GPS curve, otherwise straight */}
      {routeCurve ? (
        <CurvedWaterChannel curve={routeCurve} theme={routeTheme} />
      ) : (
        <PhotorealisticWater boatZ={boatZ} theme={routeTheme} performanceMode={performanceMode} />
      )}

      {/* Planar reflection plane — sits just below the Gerstner water mesh (#119).
          Uses MeshReflectorMaterial; only active on non-low performance modes. */}
      {!IS_TEST_MODE && performanceMode !== 'low' && !routeCurve && (
        <WaterReflectionPlane boatZ={boatZ} theme={routeTheme} />
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

      {/* Route-specific landmarks — offset by boatZ so landmark z-coords are
          relative to the boat's current position along the course. */}
      {landmarkConfig && (
        <group position={[0, 0, boatZ]}>
          <LandmarkRenderer config={landmarkConfig} />
        </group>
      )}
      
      {/* The rowing scull — kinematic Rapier body in normal mode; imperative group in Playwright mode.
          PhysicsErrorBoundary catches Rapier WASM init failures so the rest of the scene remains visible. */}
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
          strokePhase={strokePhase}
          foamIntensity={themeConfig.water.foamIntensity}
        />
      )}

      {/* Stroke-synced spray/splash particles — disabled in test mode (#122) */}
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

      {/* Post-processing effects for photorealism - disabled in test mode */}
      {!IS_TEST_MODE && performanceMode !== 'low' && (
        <DynamicPostFx
          velocityRef={velocityRef}
          performanceMode={performanceMode}
          theme={routeTheme}
          sunMeshRef={godRaysSunRef}
        />
      )}

      {/* Animated caustics SpotLight — mid/high perf only (#123) */}
      {!IS_TEST_MODE && performanceMode !== 'low' && (
        <CausticsLight boatZ={boatZ} />
      )}

      {/* Ground cover: reeds, rocks, grass — mid/high perf only (#130) */}
      {!IS_TEST_MODE && performanceMode !== 'low' && (
        <GroundCover boatZ={boatZ} theme={routeTheme} performanceMode={performanceMode} />
      )}

      {/* Horizon silhouette — all modes (#131) */}
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
