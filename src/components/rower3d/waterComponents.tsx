import React, { useRef, useMemo, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import { useCubeCamera, MeshReflectorMaterial } from '@react-three/drei';
import * as THREE from 'three';
import { IS_TEST_MODE, WATER_CHANNEL_WIDTH } from './constants';
import type { PerformanceMode } from './constants';
import { useAnimationFrame } from './AnimationContext';
import { getThemeConfig } from './themeConfig';
import type { RouteTheme } from './themeConfig';
import { attachGerstnerShader, createWaterNormalMap } from './helpers';

// ============================================================================
// WATER REFLECTION PROBE — CubeCamera providing real-time env reflections
// ============================================================================
export const WaterReflectionProbe: React.FC<{
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
    if (meshRef.current) meshRef.current.visible = false;
    update();
    if (meshRef.current) meshRef.current.visible = true;
    if (materialRef.current) {
      materialRef.current.envMap = fbo.texture;
      materialRef.current.envMapIntensity = 0.35;
    }
  });

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
// HIGH-DEFINITION PHOTOREALISTIC WATER
// ============================================================================
export const PhotorealisticWater: React.FC<{ boatZ: number; theme: RouteTheme; performanceMode?: PerformanceMode }> = ({ boatZ, theme, performanceMode }) => {
  const materialRef    = useRef<THREE.MeshPhysicalMaterial>(null);
  const meshRef        = useRef<THREE.Mesh>(null);
  const timeUniformRef = useRef({ value: 0 });

  const waterConfig = useMemo(() => getThemeConfig(theme).water, [theme]);

  const waterNormalMap = useMemo(() => createWaterNormalMap(3.0), []);
  useEffect(() => () => { waterNormalMap.dispose(); }, [waterNormalMap]);

  useEffect(() => {
    if (IS_TEST_MODE) return;
    const mat = materialRef.current;
    if (!mat) return;
    attachGerstnerShader(mat, timeUniformRef.current, 'z', theme, waterConfig.waveAmplitude, waterConfig.waveFrequency);
    mat.needsUpdate = true;
  }, [theme]);

  useAnimationFrame((time) => {
    timeUniformRef.current.value = time;

    if (materialRef.current) {
      const windVariation = Math.sin(time * 0.3) * 0.015 + Math.sin(time * 0.7) * 0.008;
      materialRef.current.roughness = waterConfig.roughness + windVariation;

      const causticPulse = (Math.sin(time * 1.2) * 0.5 + 0.5) * 0.02;
      materialRef.current.emissiveIntensity = waterConfig.emissiveIntensity + causticPulse;
    }

    waterNormalMap.offset.x = (time * 0.02) % 1;
    waterNormalMap.offset.y = (time * 0.01) % 1;
    waterNormalMap.needsUpdate = true;
  });

  return (
    <>
      <mesh ref={meshRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.1, boatZ]} receiveShadow>
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
// WATER REFLECTION PLANE — flat plane with MeshReflectorMaterial (#119)
// ============================================================================
export const WaterReflectionPlane: React.FC<{ boatZ: number; theme: RouteTheme }> = ({ boatZ, theme }) => {
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
export const MistLayer: React.FC<{ boatZ: number; theme: RouteTheme }> = ({ boatZ, theme }) => {
  const layer1Ref = useRef<THREE.Mesh>(null);
  const layer2Ref = useRef<THREE.Mesh>(null);

  const mistConfig = useMemo(() => getThemeConfig(theme).mist, [theme]);

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
      <mesh ref={layer1Ref} position={[0, mistConfig.height1, boatZ]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[900, 900]} />
        <meshBasicMaterial color={mistConfig.color1} transparent opacity={mistConfig.baseOpacity * mistConfig.density} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
      <mesh ref={layer2Ref} position={[0, mistConfig.height2, boatZ]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[1200, 1200]} />
        <meshBasicMaterial color={mistConfig.color2} transparent opacity={mistConfig.baseOpacity * 0.4} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
};

// ============================================================================
// HD CURVED WATER CHANNEL - Follows GPS path with realistic water rendering
// ============================================================================
export interface CurvedWaterChannelProps {
  curve: THREE.CatmullRomCurve3 | null;
  theme: RouteTheme;
}

export const CurvedWaterChannel: React.FC<CurvedWaterChannelProps> = ({ curve, theme }) => {
  const meshRef        = useRef<THREE.Mesh>(null);
  const materialRef    = useRef<THREE.MeshPhysicalMaterial>(null);
  const timeUniformRef = useRef({ value: 0 });

  const waterConfig = useMemo(() => getThemeConfig(theme).water, [theme]);

  useEffect(() => {
    if (IS_TEST_MODE) return;
    const mat = materialRef.current;
    if (!mat) return;
    attachGerstnerShader(mat, timeUniformRef.current, 'y', `curved-${theme}`);
    mat.needsUpdate = true;
  }, [theme]);

  useAnimationFrame((time) => {
    timeUniformRef.current.value = time;
    if (materialRef.current) {
      const windVariation = Math.sin(time * 0.3) * 0.012 + Math.sin(time * 0.7) * 0.006;
      materialRef.current.roughness = waterConfig.roughness + windVariation;
    }
  });

  const waterGeometry = useMemo(() => {
    if (!curve) return null;

    const segments = 200;
    const halfWidth = WATER_CHANNEL_WIDTH / 2;

    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];

    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const point = curve.getPointAt(t);
      const tangent = curve.getTangentAt(t).normalize();

      const up = new THREE.Vector3(0, 1, 0);
      const perp = new THREE.Vector3().crossVectors(tangent, up).normalize();

      const left = new THREE.Vector3().copy(point).addScaledVector(perp, -halfWidth);
      const right = new THREE.Vector3().copy(point).addScaledVector(perp, halfWidth);

      left.y = -0.1;
      right.y = -0.1;

      positions.push(left.x, left.y, left.z);
      positions.push(right.x, right.y, right.z);

      normals.push(0, 1, 0);
      normals.push(0, 1, 0);

      uvs.push(0, t);
      uvs.push(1, t);

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
  }, [curve]);

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
