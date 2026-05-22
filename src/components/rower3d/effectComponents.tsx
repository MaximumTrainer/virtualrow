import React, { useRef, useMemo, useEffect } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { EffectComposer, Bloom, ToneMapping, Vignette, DepthOfField, SSAO, GodRays, HueSaturation, BrightnessContrast } from '@react-three/postprocessing';
import { ToneMappingMode, ChromaticAberrationEffect } from 'postprocessing';
import * as THREE from 'three';
import { IS_TEST_MODE } from './constants';
import type { PerformanceMode } from './constants';
import { useAnimationFrame } from './AnimationContext';
import { getThemeConfig } from './themeConfig';
import type { RouteTheme, ColorGradingConfig } from './themeConfig';
import { createCausticsTexture } from './helpers';

// ============================================================================
// WAKE EFFECT — V-shaped Kelvin wake trailing behind the boat, velocity-scaled
// ============================================================================
export const WakeEffect: React.FC<{
  positionRef: React.MutableRefObject<THREE.Vector3>;
  rotationRef: React.MutableRefObject<number>;
  velocityRef: React.MutableRefObject<number>;
}> = ({ positionRef, rotationRef, velocityRef }) => {
  const groupRef    = useRef<THREE.Group>(null);
  const leftMatRef  = useRef<THREE.MeshBasicMaterial>(null);
  const rightMatRef = useRef<THREE.MeshBasicMaterial>(null);
  const sternMatRef = useRef<THREE.MeshBasicMaterial>(null);

  const HALF_ANGLE = Math.PI / 9.2;
  const WAKE_LEN = 5;

  useFrame(() => {
    const g = groupRef.current;
    if (!g) return;

    const vel = velocityRef.current;
    g.position.copy(positionRef.current);
    g.rotation.y = rotationRef.current;

    const alpha = Math.min(vel / 2.5, 1.0) * 0.3;
    const visible = vel > 0.15;
    for (const matRef of [leftMatRef, rightMatRef, sternMatRef]) {
      if (matRef.current) {
        matRef.current.opacity  = alpha;
        matRef.current.visible  = visible;
      }
    }
    const s = Math.min(vel / 4.17, 1.0);
    g.scale.set(s, 1, s);
  });

  const armAngle = HALF_ANGLE;
  const halfLen  = WAKE_LEN / 2;

  return (
    <group ref={groupRef}>
      <mesh
        position={[-Math.sin(armAngle) * halfLen, -0.07, -Math.cos(armAngle) * halfLen]}
        rotation={[-Math.PI / 2, 0, armAngle]}
      >
        <planeGeometry args={[0.35, WAKE_LEN, 1, 8]} />
        <meshBasicMaterial ref={leftMatRef} color="white" transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
      <mesh
        position={[Math.sin(armAngle) * halfLen, -0.07, -Math.cos(armAngle) * halfLen]}
        rotation={[-Math.PI / 2, 0, -armAngle]}
      >
        <planeGeometry args={[0.35, WAKE_LEN, 1, 8]} />
        <meshBasicMaterial ref={rightMatRef} color="white" transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[0, -0.07, -halfLen * 0.6]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[1.2, halfLen * 1.2, 1, 4]} />
        <meshBasicMaterial ref={sternMatRef} color="white" transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
};

// ============================================================================
// BLADE ENTRY FOAM — white foam sprites at oar-blade entry on the catch phase
// ============================================================================
export const BladeEntryFoam: React.FC<{
  positionRef: React.MutableRefObject<THREE.Vector3>;
  rotationRef: React.MutableRefObject<number>;
  strokePhase: string;
  foamIntensity?: number;
}> = ({ positionRef, rotationRef, strokePhase, foamIntensity = 0.65 }) => {
  const leftRef  = useRef<THREE.Mesh>(null);
  const rightRef = useRef<THREE.Mesh>(null);
  const leftMatRef  = useRef<THREE.MeshBasicMaterial>(null);
  const rightMatRef = useRef<THREE.MeshBasicMaterial>(null);

  const foamLifeRef = useRef(0);
  const prevPhaseRef = useRef('recovery');

  useFrame((_, delta) => {
    const left  = leftRef.current;
    const right = rightRef.current;
    const lMat  = leftMatRef.current;
    const rMat  = rightMatRef.current;
    if (!left || !right || !lMat || !rMat) return;

    if (strokePhase === 'catch' && prevPhaseRef.current !== 'catch') {
      foamLifeRef.current = 1.0;
    }
    prevPhaseRef.current = strokePhase;

    foamLifeRef.current = Math.max(0, foamLifeRef.current - delta / 0.6);
    const alpha = foamLifeRef.current * foamIntensity;

    const pos = positionRef.current;
    const rot = rotationRef.current;
    const cosR = Math.cos(rot);
    const sinR = Math.sin(rot);
    const span = 3.2;

    left.position.set(pos.x - cosR * span, pos.y - 0.05, pos.z + sinR * span);
    right.position.set(pos.x + cosR * span, pos.y - 0.05, pos.z - sinR * span);

    lMat.opacity = alpha;
    rMat.opacity = alpha;
    lMat.visible = alpha > 0.01;
    rMat.visible = alpha > 0.01;
  });

  return (
    <>
      <mesh ref={leftRef} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.55, 12]} />
        <meshBasicMaterial ref={leftMatRef} color="white" transparent opacity={0} depthWrite={false} />
      </mesh>
      <mesh ref={rightRef} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.55, 12]} />
        <meshBasicMaterial ref={rightMatRef} color="white" transparent opacity={0} depthWrite={false} />
      </mesh>
    </>
  );
};

// ============================================================================
// PMREM ENVIRONMENT — generates env map from the procedural skydome via
// PMREMGenerator (#121).
// ============================================================================
export const PMREMEnvironment: React.FC<{ theme: RouteTheme }> = ({ theme }) => {
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
// DRIVE SPRAY — small spray particles at blade-entry sites during 'drive' phase (#122)
// ============================================================================
export const DRIVE_PARTICLE_COUNT = 24;
export const DriveSpray: React.FC<{
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
// FINISH SPLASH — brief burst at blade-exit on 'finish' phase (#122)
// ============================================================================
export const FINISH_PARTICLE_COUNT = 32;
export const FinishSplash: React.FC<{
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
// CAUSTICS LIGHT — animated SpotLight with caustics cookie texture (#123)
// ============================================================================
export const CausticsLight: React.FC<{ boatZ: number }> = ({ boatZ }) => {
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
      const r = 2.0;
      spotRef.current.position.x = Math.sin(time * 0.4) * r;
      spotRef.current.position.z = boatZ + Math.cos(time * 0.4) * r;
    }
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
// DYNAMIC POST-PROCESSING — velocity-gated chromatic aberration + depth-of-field
// + bloom, vignette, ACES filmic tone mapping.
// ============================================================================
export const DynamicPostFx: React.FC<{
  velocityRef: React.MutableRefObject<number>;
  performanceMode?: PerformanceMode;
  theme: RouteTheme;
  sunMeshRef?: React.RefObject<THREE.Mesh>;
}> = ({ velocityRef, performanceMode, theme, sunMeshRef }) => {
  const caEffect = useMemo(() => new ChromaticAberrationEffect({ offset: new THREE.Vector2(0, 0), radialModulation: false, modulationOffset: 0 }), []);
  useEffect(() => () => caEffect.dispose(), [caEffect]);

  const colorGrading: ColorGradingConfig = useMemo(() => getThemeConfig(theme).colorGrading, [theme]);

  useFrame(({ gl }) => {
    const vel = velocityRef.current;
    const aberration = Math.min(vel / 8.0, 1.0) * 0.0018;
    caEffect.offset.set(aberration, aberration * 0.6);

    const targetExposure = vel > 3 ? 0.85 : 1.0;
    gl.toneMappingExposure = THREE.MathUtils.lerp(gl.toneMappingExposure, targetExposure, 0.015);
  });

  if (performanceMode === 'auto') {
    return (
      <EffectComposer enableNormalPass>
        <SSAO samples={16} rings={3} distanceThreshold={1.0} distanceFalloff={0.1} rangeThreshold={0.5} rangeFalloff={0.1} luminanceInfluence={0.9} radius={10} bias={0.5} intensity={0.8} />
        <Bloom intensity={0.28} luminanceThreshold={0.72} luminanceSmoothing={0.85} />
        <primitive object={caEffect} />
        <HueSaturation hue={colorGrading.hue} saturation={colorGrading.saturation} />
        <BrightnessContrast brightness={colorGrading.brightness} contrast={colorGrading.contrast} />
        <Vignette eskil={false} offset={0.3} darkness={0.5} />
        <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
      </EffectComposer>
    );
  }

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
