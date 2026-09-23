import React, { useCallback, useRef, useMemo, useEffect } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { useCubeCamera, MeshReflectorMaterial } from '@react-three/drei';
import * as THREE from 'three';
import { useFollowZ } from './followBoat';
import { IS_TEST_MODE, SCENE_SCALE, WATER_CHANNEL_WIDTH } from './constants';
import type { PerformanceMode } from './constants';
import { useAnimationFrame } from './animationFrame';
import { SCENE_CONFIG } from './themeConfig';
import { attachGerstnerShader, attachWaterSurface, createWaterNormalMap } from './helpers';
import { createRippleNormalMap } from './rippleTexture';
import { buildSkyEnvironment } from './skyEnvironment';
import { rippleRepeat, rippleScroll, waterMaterialPlan } from './waterMaterial';
import { curveLengthMeters } from './curve';
import { createWaterChannelGeometry } from './waterGeometry';
import { RouteStripChunks } from './routeStripChunks';
import { chunkViewDistanceFor } from './fogPlan';
import type { ProgressRange } from './geometryChunks';
import type { RouteEnrichmentData } from '../../services/routeEnrichmentService';

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
    const material = materialRef.current;
    return () => {
      if (material) {
        material.envMap = null;
        material.needsUpdate = true;
      }
    };
  }, [materialRef]);

  return null;
};

// ============================================================================
// HIGH-DEFINITION PHOTOREALISTIC WATER
// ============================================================================
export const PhotorealisticWater: React.FC<{
  /** Where the flat water sits — the boat's Z, followed without a render (#331). */
  followRef?: React.RefObject<THREE.Vector3 | null>;
  performanceMode?: PerformanceMode;
}> = ({ followRef, performanceMode }) => {
  const materialRef    = useRef<THREE.MeshPhysicalMaterial>(null);
  const meshRef        = useRef<THREE.Mesh>(null);
  useFollowZ(meshRef, followRef);
  const timeUniformRef = useRef({ value: 0 });
  const waterNormalMapRef = useRef<THREE.Texture | null>(null);

  const waterConfig = SCENE_CONFIG.water;

  const waterNormalMap = useMemo(() => createWaterNormalMap(3.0), []);
  useEffect(() => {
    waterNormalMapRef.current = waterNormalMap;
    return () => {
      waterNormalMapRef.current = null;
      waterNormalMap.dispose();
    };
  }, [waterNormalMap]);

  useEffect(() => {
    if (IS_TEST_MODE) return;
    const mat = materialRef.current;
    if (!mat) return;
    attachGerstnerShader(mat, timeUniformRef.current, 'z', 'flat', waterConfig.waveAmplitude, waterConfig.waveFrequency);
    mat.needsUpdate = true;
  }, [waterConfig.waveAmplitude, waterConfig.waveFrequency]);

  useAnimationFrame((time) => {
    timeUniformRef.current.value = time;

    if (materialRef.current) {
      const windVariation = Math.sin(time * 0.3) * 0.015 + Math.sin(time * 0.7) * 0.008;
      materialRef.current.roughness = waterConfig.roughness + windVariation;

      const causticPulse = (Math.sin(time * 1.2) * 0.5 + 0.5) * 0.02;
      materialRef.current.emissiveIntensity = waterConfig.emissiveIntensity + causticPulse;
    }

    const normalMap = waterNormalMapRef.current;
    if (normalMap) {
      normalMap.offset.x = (time * 0.02) % 1;
      normalMap.offset.y = (time * 0.01) % 1;
      normalMap.needsUpdate = true;
    }
  });

  return (
    <>
      <mesh ref={meshRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.1, 0]} receiveShadow>
        <planeGeometry args={[1000, 1000, performanceMode !== 'low' ? 64 : 32, performanceMode !== 'low' ? 64 : 32]} />
        <meshPhysicalMaterial
          ref={materialRef}
          color={waterConfig.color}
          metalness={0.05}
          roughness={waterConfig.roughness}
          transmission={waterConfig.transmission * 0.3}
          thickness={waterConfig.thickness}
          ior={1.333}
          reflectivity={0.35}
          clearcoat={0.25}
          clearcoatRoughness={0.35}
          envMapIntensity={0.6}
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
export const WaterReflectionPlane: React.FC<{
  /** Where the plane sits — the boat's Z, followed without a render (#331). */
  followRef?: React.RefObject<THREE.Vector3 | null>;
}> = ({ followRef }) => {
  const planeRef = useRef<THREE.Mesh>(null);
  useFollowZ(planeRef, followRef);
  const waterConfig = SCENE_CONFIG.water;
  return (
    <mesh ref={planeRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.12, 0]}>
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
// HD CURVED WATER CHANNEL - Follows GPS path with realistic water rendering
// ============================================================================
export interface CurvedWaterChannelProps {
  curve: THREE.CatmullRomCurve3 | null;
  enrichment?: RouteEnrichmentData | null;
  /** Which water the tier pays for (#324). */
  performanceMode?: PerformanceMode;
}

export const CurvedWaterChannel: React.FC<CurvedWaterChannelProps> = ({
  curve,
  enrichment,
  performanceMode = 'auto',
}) => {
  const timeUniformRef = useRef({ value: 0 });
  const { gl } = useThree();
  const plan = useMemo(() => waterMaterialPlan(performanceMode), [performanceMode]);

  // The chop, per-pixel. Two layers of the same tile scrolling at different
  // rates: three takes one `normalMap`, and the second layer is the same
  // texture sampled through its own offset in `attachRippleLayer`.
  const rippleMap = useMemo(() => createRippleNormalMap(), []);
  const ripple2Ref = useRef({
    uRipple2Offset: { value: new THREE.Vector2() },
    // A different scale as well as a different rate, so the two layers never
    // settle into a moire with each other.
    uRipple2Scale: { value: 1.7 },
  });

  // Built from a scene holding only the sky, once (#324). The scene
  // environment `PMREMEnvironment` builds is captured on mount, before `Sky`
  // has drawn, so it is close to black — which is what "no environment map to
  // reflect" meant.
  const skyConfig = SCENE_CONFIG.sky;
  const environment = useMemo(
    () => (IS_TEST_MODE ? null : buildSkyEnvironment(gl, skyConfig)),
    [gl, skyConfig],
  );
  useEffect(() => () => environment?.dispose(), [environment]);

  const waterConfig = useMemo(() => {
    const baseConfig = SCENE_CONFIG.water;
    return {
      ...baseConfig,
      color: enrichment?.waterColor ?? baseConfig.color,
      waveAmplitude: baseConfig.waveAmplitude * (enrichment?.waveIntensity ?? 1),
      waveFrequency: baseConfig.waveFrequency * (enrichment?.waveIntensity ?? 1),
    };
  }, [enrichment?.waterColor, enrichment?.waveIntensity]);

  // One material for every chunk of the channel: the Gerstner shader is
  // compiled once and the per-frame roughness is written once (#224).
  const material = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        // Standard, not physical. The physical material rendered nothing at
        // all here: a probe material on the same geometry drew 4.1% of the
        // frame while the physical one drew none of it, so the river was
        // simply absent and the sky showed through where the water should be
        // (#269). Its realism came from transmission, which needs a scene
        // behind the surface to refract and had none.
        color: waterConfig.color,
        // Smooth, with ripples and a sky to reflect (#324). The old 0.55 and
        // the emissive lift were both standing in for a reflection that was
        // never there: an emissive surface is one that glows in its own right,
        // which is the one thing water does not do.
        roughness: plan.roughness,
        metalness: plan.metalness,
        envMapIntensity: plan.envMapIntensity,
        normalMap: rippleMap ?? null,
        normalScale: new THREE.Vector2(plan.normalScale, plan.normalScale),
        envMap: environment,
        side: THREE.DoubleSide,
      }),
    [waterConfig, plan, rippleMap, environment],
  );

  useEffect(() => () => material.dispose(), [material]);

  // The channel's uv runs 0-1 across the water and 0-1 along the whole route,
  // so a tile left at its default repeat covers kilometres and contributes
  // nothing. The repeat is the route measured in tiles (#324).
  useEffect(() => {
    if (!rippleMap || !curve) return;
    const { x, y } = rippleRepeat({
      widthMetres: enrichment?.waterWidthMeters ?? WATER_CHANNEL_WIDTH / SCENE_SCALE,
      lengthMetres: curveLengthMeters(curve),
    });
    // A THREE texture is a handle to GPU state; its repeat is written in
    // place by design.
    rippleMap.repeat.set(x, y);
  }, [rippleMap, curve, enrichment?.waterWidthMeters]);

  useEffect(() => {
    if (IS_TEST_MODE) return;
    attachGerstnerShader(
      material,
      timeUniformRef.current,
      'y',
      'curved',
      waterConfig.waveAmplitude,
      waterConfig.waveFrequency,
    );
    // The second ripple layer and the fresnel blend, chained onto the vertex
    // hook the Gerstner shader just installed (#324).
    attachWaterSurface(material, ripple2Ref.current);
    // react-hooks/immutability: a THREE material is a handle to a compiled
    // shader program, mutated in place by design. Recreating it per frame
    // would recompile the Gerstner shader on every tick.
    // eslint-disable-next-line react-hooks/immutability
    material.needsUpdate = true;
  }, [material, waterConfig.waveAmplitude, waterConfig.waveFrequency]);

  useAnimationFrame((time) => {
    timeUniformRef.current.value = time;
    const windVariation = Math.sin(time * 0.3) * 0.012 + Math.sin(time * 0.7) * 0.006;
    /* eslint-disable react-hooks/immutability */
    // A THREE material and texture are handles to GPU state, written in place
    // by design: the wind ripple and the scrolling chop are uniform writes.
    //
    // The roughness is the tier's, not the config's. It was the config's, which
    // is 0.10 - so the per-frame write undid whatever the material was built
    // with, and the tier plan would have had no effect past the first frame.
    material.roughness = plan.roughness + windVariation;

    const scroll = rippleScroll(time);
    if (rippleMap) rippleMap.offset.set(scroll.first.x, scroll.first.y);
    ripple2Ref.current.uRipple2Offset.value.set(scroll.second.x, scroll.second.y);
    /* eslint-enable react-hooks/immutability */
  });

  const buildChunk = useCallback(
    (range: ProgressRange) =>
      createWaterChannelGeometry(curve as THREE.CatmullRomCurve3, { enrichment, range }),
    [curve, enrichment],
  );

  if (!curve) return null;

  return (
    <RouteStripChunks
      curve={curve}
      material={material}
      buildChunk={buildChunk}
      viewDistance={chunkViewDistanceFor()}
      renderMaterial={
        plan.useMirror && !IS_TEST_MODE
          ? () => (
              <MeshReflectorMaterial
                resolution={512}
                mirror={0.6}
                blur={[120, 40]}
                mixBlur={0.6}
                mixStrength={1.2}
                color={waterConfig.color}
                roughness={plan.roughness}
                metalness={plan.metalness}
                normalMap={rippleMap ?? undefined}
                normalScale={new THREE.Vector2(plan.normalScale, plan.normalScale)}
                side={THREE.DoubleSide}
              />
            )
          : undefined
      }
    />
  );
};
