import React, { useRef, useMemo, useEffect } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { EffectComposer, Bloom, ToneMapping, Vignette, DepthOfField, SSAO, GodRays, HueSaturation, BrightnessContrast } from '@react-three/postprocessing';
import { ToneMappingMode, ChromaticAberrationEffect, type DepthOfFieldEffect } from 'postprocessing';
import * as THREE from 'three';
import { effectPlanFor, type EffectName } from './effectPlan';
import { IS_TEST_MODE } from './constants';
import { canInitialisePostProcessing } from './postProcessingGuard';
import { sceneExposure } from './sceneExposure';
import type { PerformanceMode } from './constants';
import { useAnimationFrame } from './animationFrame';
import { getThemeConfig } from './themeConfig';
import { recordComposerMounted } from './composerState';
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
    // react-hooks/immutability: `scene` is the live three.js graph handed over
    // by useThree, not React state. Installing the environment map on it is
    // the documented way to light an R3F scene.
    // eslint-disable-next-line react-hooks/immutability
    scene.environment = envRT.texture;
    return () => {
      envRT.texture.dispose();
      envRT.dispose();
      pmremGen.dispose();
      scene.environment = null;
    };
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
  const causticsTexture = useMemo(() => createCausticsTexture(), []);
  useEffect(() => () => { causticsTexture.dispose(); }, [causticsTexture]);

  useAnimationFrame((time) => {
    if (spotRef.current) {
      const r = 2.0;
      spotRef.current.position.x = Math.sin(time * 0.4) * r;
      spotRef.current.position.z = boatZ + Math.cos(time * 0.4) * r;
    }
    if (causticsTexture) {
      // react-hooks/immutability: a THREE texture is a handle to GPU state and
      // is mutated in place by design — scrolling its offset is how the
      // caustics animate. There is no immutable equivalent, and reallocating
      // the texture each frame would be a leak.
      /* eslint-disable react-hooks/immutability */
      causticsTexture.offset.x = (time * 0.03) % 1;
      causticsTexture.offset.y = (time * 0.02) % 1;
      causticsTexture.needsUpdate = true;
      /* eslint-enable react-hooks/immutability */
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
  /**
   * The sun mesh itself, not a ref to it: GodRaysEffect dereferences the light
   * source every frame, and a ref is truthy before its mesh exists (#233).
   */
  sunMesh?: THREE.Mesh | null;
  /** Where the boat is, so depth of field can focus on it rather than on a fixed distance. */
  boatPositionRef: React.MutableRefObject<THREE.Vector3>;
}> = ({ velocityRef, performanceMode, theme, sunMesh, boatPositionRef }) => {
  const gl = useThree((state) => state.gl);
  const caEffect = useMemo(() => new ChromaticAberrationEffect({ offset: new THREE.Vector2(0, 0), radialModulation: false, modulationOffset: 0 }), []);
  useEffect(() => () => caEffect.dispose(), [caEffect]);

  /**
   * Whether postprocessing can initialise at all.
   *
   * Asked on every render rather than memoised on the renderer. `postprocessing`
   * dereferences `getContextAttributes().alpha` in both setRenderer and addPass,
   * and the renderer object does not change identity when its context goes — so
   * a verdict cached at mount stayed `true` after the attributes had gone, and
   * the next effect-list change threw anyway (#257). The check is two property
   * reads; caching it was never worth a stale answer.
   */
  const canPostProcess = canInitialisePostProcessing(gl);

  useEffect(() => {
    if (!canPostProcess) {
      console.warn(
        '[rower3d] Postprocessing unavailable — WebGL context reports no attributes. '
        + 'Rendering the scene without the effect stack.',
      );
    }
  }, [canPostProcess]);

  const colorGrading: ColorGradingConfig = useMemo(() => getThemeConfig(theme).colorGrading, [theme]);

  const plan = effectPlanFor(performanceMode ?? 'auto', { hasSun: !!sunMesh });

  /**
   * Exactly one tone-mapping stage (#327) — and it is already the composer's.
   *
   * `@react-three/postprocessing`'s EffectComposer sets `gl.toneMapping` to
   * NoToneMapping on mount and restores it on cleanup, because three disallows
   * tone mapping on render targets. VR-07's premise is conditional - "unless
   * the composer disables renderer tone mapping" - and it does, so the frame
   * was never actually graded twice.
   *
   * Setting it here as well duplicated that and raced its save-and-restore: the
   * renderer read NoToneMapping for the first frames and then flipped back to
   * ACES and stayed, which is the opposite of the requirement. So nothing is
   * written here. Where ACES runs is stated in the plan and asserted in
   * `effectPlan.test.ts` and `rower3d-postfx.spec.ts`, which is what VR-07's
   * scope asks for: the choice made explicit and tested.
   */

  const mounted = canPostProcess && plan.composer;
  useEffect(() => {
    recordComposerMounted(mounted);
    return () => recordComposerMounted(false);
  }, [mounted]);

  const dofRef = useRef<DepthOfFieldEffect>(null);

  useFrame(({ gl, camera }) => {
    // Held every frame, not set once (#327).
    //
    // EffectComposer sets NoToneMapping on mount and saves the previous value
    // to restore on cleanup, because three disallows tone mapping on render
    // targets. Something puts ACES back afterwards - measured going 0 on the
    // first frames and 4 for every frame after - and ACES on the renderer with
    // the composer's own ToneMapping pass running is precisely the double grade
    // VR-07 is about. A frame is cheap to state the truth in, and it cannot be
    // stomped by a restore that happens later.
    gl.toneMapping = plan.toneMapOnRenderer
      ? THREE.ACESFilmicToneMapping
      : THREE.NoToneMapping;

    const vel = velocityRef.current;
    // Focused on the boat, not on a distance chosen once. Ten metres with a
    // range of twenty-five put the whole far bank in bokeh (#327).
    const dof = dofRef.current;
    if (dof) {
      dof.cocMaterial.worldFocusDistance = camera.position.distanceTo(boatPositionRef.current);
    }
    const aberration = Math.min(vel / 8.0, 1.0) * 0.0018;
    caEffect.offset.set(aberration, aberration * 0.6);

    // Relative to the exposure the theme authored, not to a hardcoded 1.0 —
    // which is what rendered the sky, and the water reflecting it, white (#269).
    const targetExposure = sceneExposure(theme, vel);
    gl.toneMappingExposure = THREE.MathUtils.lerp(gl.toneMappingExposure, targetExposure, 0.015);
  });

  // Every hook above runs unconditionally; only the render bails out.
  if (!canPostProcess) return null;

  if (!plan.composer) return null;

  const has = (effect: EffectName) => plan.effects.includes(effect);

  return (
    <EffectComposer enableNormalPass={plan.normalPass}>
      {[
        has('ssao') ? (
          <SSAO
            key="ssao"
            samples={plan.ssaoSamples ?? 16}
            rings={4}
            distanceThreshold={0.6}
            distanceFalloff={0.1}
            rangeThreshold={0.5}
            rangeFalloff={0.1}
            luminanceInfluence={0.9}
            radius={1.5}
            bias={0.5}
            intensity={0.8}
          />
        ) : null,
        has('bloom') ? (
          <Bloom key="bloom" intensity={0.18} luminanceThreshold={0.9} luminanceSmoothing={0.85} />
        ) : null,
        has('chromaticAberration') ? <primitive key="ca" object={caEffect} /> : null,
        has('depthOfField') ? (
          <DepthOfField
            key="dof"
            ref={dofRef}
            worldFocusRange={60}
            bokehScale={1.2}
            height={480}
          />
        ) : null,
        has('hueSaturation') ? (
          <HueSaturation key="hue" hue={colorGrading.hue} saturation={colorGrading.saturation} />
        ) : null,
        has('brightnessContrast') ? (
          <BrightnessContrast
            key="bc"
            brightness={colorGrading.brightness}
            contrast={colorGrading.contrast}
          />
        ) : null,
        has('godRays') && sunMesh ? (
          <GodRays
            key="godrays"
            sun={sunMesh}
            exposure={0.34}
            decay={0.85}
            density={0.85}
            weight={0.4}
            samples={60}
          />
        ) : null,
        has('vignette') ? <Vignette key="vignette" eskil={false} offset={0.3} darkness={0.25} /> : null,
        has('toneMapping') ? <ToneMapping key="tone" mode={ToneMappingMode.ACES_FILMIC} /> : null,
      ].filter((effect): effect is React.ReactElement => effect !== null)}
    </EffectComposer>
  );
};
