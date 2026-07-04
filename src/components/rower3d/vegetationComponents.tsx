import React, { useRef, useMemo, useEffect } from 'react';
import * as THREE from 'three';
import { useAnimationFrame } from './AnimationContext';
import { getThemeConfig } from './themeConfig';
import type { RouteTheme, TreeSpeciesEntry } from './themeConfig';
import { RENDER_CONFIG } from './constants';
import type { PerformanceMode } from './constants';
import { seededRandom } from './helpers';
import type { RouteEnrichmentData } from '../../services/routeEnrichmentService';
import { SCENERY_PROFILES } from './sceneryConfig';

// ============================================================================
// FOLIAGE SWAY — shared wind-sway vertex shader helper (#107)
// ============================================================================
export function makeSwayFoliageMaterial(
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
export const PineTrees: React.FC<{ side: 'left' | 'right'; boatZ: number; theme?: RouteTheme; enrichment?: RouteEnrichmentData | null }> = ({ side, boatZ, theme = 'willowbrook', enrichment }) => {
  const xBase = side === 'left' ? -25 : 25;

  // Derive the dominant scenery profile from the first enrichment segment.
  const sceneryProfile = enrichment?.segmentProfiles?.[0]?.sceneryProfile ?? 'fallback';
  const profileConfig = SCENERY_PROFILES[sceneryProfile];

  const allSpeciesList = useMemo(() => getThemeConfig(theme).trees.species, [theme]);

  // Filter to only those species types allowed by the profile; fall back to
  // the full theme list when the profile's species aren't represented.
  const speciesList = useMemo<TreeSpeciesEntry[]>(() => {
    const allowed = new Set(profileConfig.trees.species);
    const filtered = allSpeciesList.filter(s => allowed.has(s.type));
    return filtered.length > 0 ? filtered : allSpeciesList;
  }, [allSpeciesList, profileConfig.trees.species]);

  const [scaleMin, scaleMax] = profileConfig.trees.scaleRange;

  const trees = useMemo(() => {
    const result: Array<{ x: number; z: number; scale: number; variant: number; rotation: number; isNear: boolean; species: TreeSpeciesEntry }> = [];
    for (let z = -400; z < 400; z += 8) {
      const treeIdx = Math.round((z + 400) / 8);
      // Scale instance count by profile density (clamped to 1–3).
      const rawCount = 1 + Math.floor(seededRandom(treeIdx * 9 + 1) * 2);
      const count = Math.max(1, Math.round(rawCount * profileConfig.trees.density));
      for (let j = 0; j < count; j++) {
        const speciesIdx = Math.floor(seededRandom(treeIdx * 9 + j * 4 + 7) * speciesList.length);
        const sp = speciesList[speciesIdx];
        const scaleFraction = seededRandom(treeIdx * 9 + j * 4 + 4);
        result.push({
          x: xBase + (seededRandom(treeIdx * 9 + j * 4 + 2) - 0.5) * 15 + (side === 'left' ? -5 : 5),
          z: z + (seededRandom(treeIdx * 9 + j * 4 + 3) - 0.5) * 6,
          scale: scaleMin + scaleFraction * (scaleMax - scaleMin),
          variant: Math.floor(seededRandom(treeIdx * 9 + j * 4 + 5) * 3),
          rotation: seededRandom(treeIdx * 9 + j * 4 + 6) * Math.PI * 2,
          isNear: Math.abs(z) <= 40,
          species: sp,
        });
      }
    }
    return result;
  }, [xBase, side, speciesList, profileConfig.trees.density, scaleMin, scaleMax]);

  const swayTime = useMemo<THREE.IUniform<number>>(() => ({ value: 0 }), []);

  const primaryColor = speciesList[0]?.color ?? '#1a4020';
  const foliageMats = useMemo(() => [
    makeSwayFoliageMaterial({ color: primaryColor, roughness: 0.85, metalness: 0.0, transmission: 0.05, thickness: 0.5, sheen: 0.3, sheenColor: new THREE.Color(primaryColor) }, swayTime),
    makeSwayFoliageMaterial({ color: primaryColor, roughness: 0.80, metalness: 0.0, transmission: 0.08, thickness: 0.4, sheen: 0.4, sheenColor: new THREE.Color(primaryColor) }, swayTime),
    makeSwayFoliageMaterial({ color: primaryColor, roughness: 0.75, metalness: 0.0, transmission: 0.10, thickness: 0.3, sheen: 0.5, sheenColor: new THREE.Color(primaryColor) }, swayTime),
    makeSwayFoliageMaterial({ color: primaryColor, roughness: 0.70, metalness: 0.0, transmission: 0.12, thickness: 0.2, sheen: 0.6, sheenColor: new THREE.Color(primaryColor) }, swayTime),
  ], [swayTime, primaryColor]);

  useEffect(() => () => { foliageMats.forEach(m => m.dispose()); }, [foliageMats]);

  useAnimationFrame((time) => { swayTime.value = time; });

  const cone0Ref = useRef<THREE.InstancedMesh>(null);
  const cone1Ref = useRef<THREE.InstancedMesh>(null);
  const cone2Ref = useRef<THREE.InstancedMesh>(null);
  const cone3Ref = useRef<THREE.InstancedMesh>(null);

  const CONE_LAYERS = [
    [2.8, 1.4, 2.2],
    [3.8, 1.1, 2.0],
    [4.6, 0.8, 1.8],
    [5.3, 0.4, 1.2],
  ] as const;

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
      {trees.map((tree, i) => {
        const nearShadow = Math.abs(tree.z) < RENDER_CONFIG.shadowNearBand;
        const trunkColor = tree.species.trunkColor;
        const isBare = tree.species.type === 'bare';
        return (
        <group key={i} position={[tree.x, 0, tree.z]} scale={tree.scale} rotation={[0, tree.rotation, 0]}>
          <mesh position={[0, 1.2, 0]} castShadow={nearShadow}>
            <cylinderGeometry args={[0.12, 0.22, 2.4, 12]} />
            <meshPhysicalMaterial color={trunkColor} roughness={0.95} metalness={0.0} clearcoat={0.05} clearcoatRoughness={0.9} />
          </mesh>
          {[0.4, 0.8, 1.2, 1.6].map((y, j) => (
            <mesh key={j} position={[0, y, 0]} castShadow={nearShadow}>
              <torusGeometry args={[0.16 + (2.4 - y) * 0.02, 0.02, 6, 12]} />
              <meshStandardMaterial color={trunkColor} roughness={1.0} />
            </mesh>
          ))}
          <mesh position={[0, 0.1, 0]} castShadow={nearShadow}>
            <cylinderGeometry args={[0.22, 0.35, 0.3, 8]} />
            <meshPhysicalMaterial color={trunkColor} roughness={0.95} />
          </mesh>
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
// GROUND COVER — instanced reeds, rocks, and grass along the banks (#130)
// ============================================================================
export const GroundCover: React.FC<{ boatZ: number; theme: RouteTheme; performanceMode?: PerformanceMode; enrichment?: RouteEnrichmentData | null }> = ({ boatZ, theme, enrichment }) => {
  const gcConfig = useMemo(() => getThemeConfig(theme).groundCover, [theme]);

  // Derive the dominant scenery profile from the first enrichment segment.
  const sceneryProfile = enrichment?.segmentProfiles?.[0]?.sceneryProfile ?? 'fallback';
  const profileConfig = SCENERY_PROFILES[sceneryProfile];

  // Filter the theme's ground cover types to those permitted by the profile.
  const allowedTypes = new Set(profileConfig.groundCover.types);
  const filteredTypes = useMemo(
    () => gcConfig.types.filter(t => allowedTypes.has(t.type)),
    // allowedTypes is derived from profileConfig which is stable per-render
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [gcConfig, sceneryProfile],
  );
  const activeTypes = filteredTypes.length > 0 ? filteredTypes : gcConfig.types;

  const reedEntry  = useMemo(() => activeTypes.find(t => t.type === 'reed'),  [activeTypes]);
  const rockEntry  = useMemo(() => activeTypes.find(t => t.type === 'rock'),  [activeTypes]);
  const grassEntry = useMemo(() => activeTypes.find(t => t.type === 'grass' || t.type === 'flower'), [activeTypes]);

  const densityScale = profileConfig.groundCover.density;

  const reedMeshRef  = useRef<THREE.InstancedMesh>(null);
  const rockMeshRef  = useRef<THREE.InstancedMesh>(null);
  const grassMeshRef = useRef<THREE.InstancedMesh>(null);

  // Maximum instance counts (allocated once); actual visible count is scaled
  // down by densityScale from the active scenery profile.
  const REED_MAX  = 120;
  const ROCK_MAX  = 40;
  const GRASS_MAX = 80;

  const reedCount  = Math.max(1, Math.round(REED_MAX  * densityScale));
  const rockCount  = Math.max(1, Math.round(ROCK_MAX  * densityScale));
  const grassCount = Math.max(1, Math.round(GRASS_MAX * densityScale));

  const reedMat = useMemo(() => new THREE.MeshPhysicalMaterial({
    color: reedEntry?.color ?? '#8a7a50',
    roughness: 0.85,
    metalness: 0.0,
    side: THREE.DoubleSide,
  }), [reedEntry]);
  useEffect(() => () => { reedMat.dispose(); }, [reedMat]);

  const rockMat = useMemo(() => new THREE.MeshPhysicalMaterial({
    color: rockEntry?.color ?? '#666666',
    roughness: 0.9,
    metalness: 0.05,
  }), [rockEntry]);
  useEffect(() => () => { rockMat.dispose(); }, [rockMat]);

  const grassMat = useMemo(() => new THREE.MeshPhysicalMaterial({
    color: grassEntry?.color ?? '#4a7a40',
    roughness: 0.8,
    metalness: 0.0,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.9,
  }), [grassEntry]);
  useEffect(() => () => { grassMat.dispose(); }, [grassMat]);

  useEffect(() => {
    const dummy = new THREE.Object3D();

    if (reedMeshRef.current && reedEntry) {
      for (let i = 0; i < reedCount; i++) {
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
      reedMeshRef.current.count = reedCount;
      reedMeshRef.current.instanceMatrix.needsUpdate = true;
    }

    if (rockMeshRef.current && rockEntry) {
      for (let i = 0; i < rockCount; i++) {
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
      rockMeshRef.current.count = rockCount;
      rockMeshRef.current.instanceMatrix.needsUpdate = true;
    }

    if (grassMeshRef.current && grassEntry) {
      for (let i = 0; i < grassCount; i++) {
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
      grassMeshRef.current.count = grassCount;
      grassMeshRef.current.instanceMatrix.needsUpdate = true;
    }
  }, [theme, reedEntry, rockEntry, grassEntry, reedCount, rockCount, grassCount]);

  return (
    <group position={[0, 0, boatZ]}>
      {reedEntry && (
        <instancedMesh ref={reedMeshRef} args={[undefined, undefined, REED_MAX]} frustumCulled={false}>
          <cylinderGeometry args={[0.05, 0.05, 1.5, 4]} />
          <primitive object={reedMat} attach="material" />
        </instancedMesh>
      )}
      {rockEntry && (
        <instancedMesh ref={rockMeshRef} args={[undefined, undefined, ROCK_MAX]} frustumCulled={false}>
          <sphereGeometry args={[1, 5, 4]} />
          <primitive object={rockMat} attach="material" />
        </instancedMesh>
      )}
      {grassEntry && (
        <instancedMesh ref={grassMeshRef} args={[undefined, undefined, GRASS_MAX]} frustumCulled={false}>
          <planeGeometry args={[0.6, 0.6]} />
          <primitive object={grassMat} attach="material" />
        </instancedMesh>
      )}
    </group>
  );
};
