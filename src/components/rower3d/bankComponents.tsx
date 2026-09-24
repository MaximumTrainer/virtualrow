import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useFollowPoint } from './followBoat';
import { withinMountRange } from './visibilityCull';
import { RENDER_CONFIG } from './constants';
import { seededRandom } from './helpers';
import { useAnimationFrame } from './animationFrame';
import { SCENE_CONFIG } from './themeConfig';
import { createBankTexture } from './bankTexture';
import { BankFoliage } from './foliageComponents';
import { isFoliageEnabled } from './foliagePlan';
import {
  buildTerrainProfile,
  type RouteEnrichmentData,
} from '../../services/routeEnrichmentService';
import { SCENERY_PROFILES } from './sceneryConfig';
import { BANK_WATERLINE_Y, createBankGeometry, createShorelineGeometry } from './bankGeometry';
import { createShorelineTexture } from './shorelineTexture';
import { GROUND_PLANE_DEPTH_OFFSET, GROUND_PLANE_DROP_METRES, groundPlaneFor } from './groundPlane';
import { RouteStripChunks } from './routeStripChunks';
import { chunkViewDistanceFor } from './fogPlan';
import type { ProgressRange } from './geometryChunks';
import { BASE_BUILDING_HEIGHT } from './segmentScenery';
import type { SceneryTrack } from './sceneryTrack';
import { landscapeStanding, layoutLandscape } from './landscapeLayout';
import { landClearance, publishSceneryClearance } from './sceneryClearance';

// ============================================================================
// HD CURVED RIVERBANKS - Follows GPS path with realistic terrain materials
// ============================================================================
export interface CurvedRiverbanksProps {
  curve: THREE.CatmullRomCurve3 | null;
  enrichment?: RouteEnrichmentData | null;
}

/** The name on the ground plane, so a test can find it without counting meshes. */
export const GROUND_PLANE_NAME = 'GroundPlane';

/**
 * Opaque ground under the whole world (#334).
 *
 * The banks are strips whose outer reach is clamped on bends (#285), and past
 * that reach there was nothing at all - so on a bend the page background
 * showed between the bank and the horizon, as the white tears down the left of
 * `docs/screenshot-activity.png`.
 *
 * Sized and placed from the route once, rather than chased after the boat
 * every frame. VR-14 proposed a follower, which is a per-frame write and a
 * moving target for anything that reads it; a plane big enough to cover the
 * route it was built for never needs to move, and two triangles are two
 * triangles wherever they are.
 *
 * Flat and unlit by design. It is not scenery, it is the absence of a hole,
 * and anything it did beyond being the right colour would draw the eye to a
 * surface nobody should notice.
 */
/** Where the ground plane sits, just under the waterline. */
const GROUND_PLANE_Y = BANK_WATERLINE_Y - GROUND_PLANE_DROP_METRES;

export const GroundPlane: React.FC<{
  curve: THREE.CatmullRomCurve3 | null;
}> = ({ curve }) => {
  const color = SCENE_CONFIG.bank.flatColor;

  const plan = useMemo(() => groundPlaneFor(curve), [curve]);

  return (
    <mesh
      name={GROUND_PLANE_NAME}
      position={[plan.centre[0], GROUND_PLANE_Y, plan.centre[1]]}
      rotation={[-Math.PI / 2, 0, 0]}
      receiveShadow
    >
      <planeGeometry args={[plan.size, plan.size]} />
      {/* Pushed away in depth as well as in space (#328).
          It sat five centimetres under the waterline, which is nothing against
          a depth buffer stretched from a 0.1 m near plane to a 12 km far one,
          and which of the two won was decided by where the camera happened to
          be. Moving the chase camera one metre back for #328 handed the whole
          river to this plane: the boat rowed across grass, with the water
          visible only as a thread at the horizon. A polygon offset settles the
          tie in the water's favour wherever the camera stands, and moves
          nothing a rower can see. */}
      <meshStandardMaterial
        color={color}
        roughness={1}
        metalness={0}
        polygonOffset
        polygonOffsetFactor={GROUND_PLANE_DEPTH_OFFSET}
        polygonOffsetUnits={GROUND_PLANE_DEPTH_OFFSET}
      />
    </mesh>
  );
};

/** The name on each shoreline strip, so a test can find them. */
export const SHORELINE_NAME = 'Shoreline';

/**
 * The foam line where the water meets the bank (#334).
 *
 * Drawn as its own strip rather than folded into the bank, because it belongs
 * to neither surface: it straddles the water's edge, is transparent at one end,
 * and must not write depth or it would punch a hole in the water behind it.
 */
export const Shoreline: React.FC<{
  curve: THREE.CatmullRomCurve3;
  enrichment?: RouteEnrichmentData | null;
}> = ({ curve, enrichment }) => {
  const texture = useMemo(() => createShorelineTexture(), []);
  useEffect(() => () => texture?.dispose(), [texture]);

  const material = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        map: texture ?? undefined,
        transparent: true,
        // Over the water, not carved into it.
        depthWrite: false,
        side: THREE.DoubleSide,
        // The strip lies on the surface; without this it z-fights the water.
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      }),
    [texture],
  );
  useEffect(() => () => material.dispose(), [material]);

  const buildLeft = useCallback(
    (range: ProgressRange) => createShorelineGeometry(curve, 'left', { enrichment, range }),
    [curve, enrichment],
  );
  const buildRight = useCallback(
    (range: ProgressRange) => createShorelineGeometry(curve, 'right', { enrichment, range }),
    [curve, enrichment],
  );

  // No texture means no context to draw one in; the scene keeps its river.
  if (!texture) return null;

  return (
    <group name={SHORELINE_NAME}>
      <RouteStripChunks curve={curve} material={material} buildChunk={buildLeft} />
      <RouteStripChunks curve={curve} material={material} buildChunk={buildRight} />
    </group>
  );
};

export const CurvedRiverbanks: React.FC<CurvedRiverbanksProps> = ({
  curve,
  enrichment,
}) => {
  const bankConfig = SCENE_CONFIG.bank;

  // Both banks and all their chunks share one material — they are the same
  // ground, and one upload is cheaper than thirty-two (#224).
  // One mottle shared by both banks and every chunk, like the material is.
  const surface = useMemo(() => createBankTexture(), []);
  useEffect(() => () => surface.dispose(), [surface]);

  const material = useMemo(
    () =>
      new THREE.MeshPhysicalMaterial({
        color: bankConfig.color,
        // Ground, rather than a field of one colour (#292). The map multiplies
        // the configured bank colour, so the bank keeps its palette and gains
        // a surface.
        map: surface,
        roughness: bankConfig.roughness,
        metalness: bankConfig.metalness,
        emissive: new THREE.Color(bankConfig.emissive),
        emissiveIntensity: bankConfig.emissiveIntensity,
        sheen: bankConfig.sheen,
        sheenColor: new THREE.Color(bankConfig.sheenColor),
        sheenRoughness: 0.8,
        // Both faces, as the water already does.
        //
        // The banks are wound to face the sky and held short of the fold on a
        // bend, which between them get an ordinary river right. Neither is a
        // guarantee: a strip two vertices wide, offset further than the radius
        // of curvature, folds whatever its winding says, and tightening the
        // clamp to prevent that makes it worse rather than better - the fold
        // then comes from the reach changing sharply instead of from the reach
        // itself. Measured over three bends in 3 km: 32 triangles facing away
        // before, 0 after; over six, 18 remain.
        //
        // Culling is what turns one of those into a hole you can see the sky
        // through, which is what #269 was reported as. This makes the residue
        // cost a little overdraw instead (#285).
        side: THREE.DoubleSide,
      }),
    [bankConfig, surface],
  );

  useEffect(() => () => material.dispose(), [material]);

  const buildLeft = useCallback(
    (range: ProgressRange) =>
      createBankGeometry(curve as THREE.CatmullRomCurve3, 'left', { enrichment, range }),
    [curve, enrichment],
  );
  const buildRight = useCallback(
    (range: ProgressRange) =>
      createBankGeometry(curve as THREE.CatmullRomCurve3, 'right', { enrichment, range }),
    [curve, enrichment],
  );

  if (!curve) return null;

  return (
    <group>
      <RouteStripChunks
        curve={curve}
        material={material}
        buildChunk={buildLeft}
        viewDistance={chunkViewDistanceFor()}
      />
      <RouteStripChunks
        curve={curve}
        material={material}
        buildChunk={buildRight}
        viewDistance={chunkViewDistanceFor()}
      />
    </group>
  );
};

// ============================================================================
// CURVED LANDSCAPE ELEMENTS - Houses, mountains and the foliage along a curved path
// ============================================================================
/**
 * Frames between landscape culls. The same cadence the GLB scenery uses.
 */
export const LANDSCAPE_CULL_FRAME_INTERVAL = 6;

interface CurvedLandscapeProps {
  curve: THREE.CatmullRomCurve3 | null;
  /** Where the boat is, read in the frame loop to decide what is drawn (#331). */
  positionRef?: React.RefObject<THREE.Vector3 | null>;
  /** Progress at the centre of the boat's chunk, for the shadow band (#331). */
  chunkProgress: number;
  /**
   * Progress the mounted window is centred on (#331).
   *
   * Not every element on the route: a mountain here is a handful of cones
   * and a house a handful of `boxGeometry`, so everything mounted is geometry
   * resident on the GPU. Mounting the whole route took the #272 traverse from
   * 412 uploaded geometries to 766 against a ceiling of 627. The trees are
   * the exception since #333: instanced, all mounted, and culled per instance
   * by `BankFoliage`, so the window no longer applies to them. The window is the
   * width it always was; what changed is that it moves about twenty times
   * across a route instead of three thousand.
   */
  mountProgress: number;
  /** Metres past which an element stops being drawn — the fog's far plane. */
  viewDistance: number;
  enrichment?: RouteEnrichmentData | null;
  /** Authored dressing, preferred over enrichment when the route has one (#232). */
  track?: SceneryTrack | null;
}

/** The name on each house and mountain group, so a test can find them. */
export const LANDSCAPE_ELEMENT_NAME = 'LandscapeElement';

export const CurvedLandscapeElements: React.FC<CurvedLandscapeProps> = ({
  curve,
  positionRef,
  chunkProgress,
  mountProgress,
  viewDistance,
  enrichment,
  track = null,
}) => {
  const elementsGroupRef = useRef<THREE.Group>(null);
  const landscapeElements = useMemo(
    () => layoutLandscape({ curve, enrichment, track }),
    [curve, enrichment, track],
  );

  // How near the water the nearest of them stands, for the E2E that walks the
  // demo row (#379).
  useEffect(() => {
    if (!curve) return;
    publishSceneryClearance(
      'landscape',
      landClearance(landscapeStanding(landscapeElements), curve, enrichment),
    );
  }, [curve, enrichment, landscapeElements]);
  
  const colors = SCENE_CONFIG.landscapeColors;
  const archConfig = SCENE_CONFIG.architecture;
  const { camera } = useThree();

  // The houses the trees keep out of (#333).
  const houses = useMemo(
    () =>
      [...landscapeElements.leftElements, ...landscapeElements.rightElements]
        .filter((e) => e.type === 'building')
        .map((e) => ({ x: e.position.x, z: e.position.z })),
    [landscapeElements],
  );
  const foliageOn = isFoliageEnabled();

  // The elements are laid out once and switched on and off from here, rather
  // than filtered during render (#331). Every sixth frame: a tree on a bank
  // does not arrive in a sixtieth of a second.
  const cullFrameRef = useRef(0);
  useAnimationFrame(() => {
    const group = elementsGroupRef.current;
    const boat = positionRef?.current;
    if (!group || !boat) return;

    cullFrameRef.current += 1;
    if (cullFrameRef.current % LANDSCAPE_CULL_FRAME_INTERVAL !== 0) return;

    const rangeSquared = viewDistance * viewDistance;
    for (const child of group.children) {
      const dx = child.position.x - boat.x;
      const dz = child.position.z - boat.z;
      child.visible = dx * dx + dz * dz <= rangeSquared;
    }
  });

  if (!curve) return null;
  
  
  const renderElement = (el: typeof landscapeElements.leftElements[0], index: number, side: string, castNearShadow: boolean) => {
    const isNearBuilding = camera.position.distanceTo(el.position) <= 60;

    switch (el.type) {
      case 'mountain':
        return (
          <group key={`${side}-mountain-${index}`} name={LANDSCAPE_ELEMENT_NAME} position={[el.position.x, 0, el.position.z]}>
            <mesh position={[0, 8 * el.scale, 0]} castShadow={castNearShadow} receiveShadow>
              <coneGeometry args={[10 * el.scale, 20 * el.scale, 10]} />
              <meshPhysicalMaterial color={colors.mountain} roughness={0.94} metalness={0.03} clearcoat={0.015} clearcoatRoughness={0.96} sheen={0.05} sheenColor="#4a5540" />
            </mesh>
            <mesh position={[0, 14 * el.scale, 0]} castShadow={castNearShadow}>
              <coneGeometry args={[4.2 * el.scale, 8.5 * el.scale, 10]} />
              <meshPhysicalMaterial color={colors.mountainSnow} roughness={0.32} metalness={0.0} clearcoat={0.42} clearcoatRoughness={0.48} sheen={0.9} sheenColor="#d8e8f8" sheenRoughness={0.4} />
            </mesh>
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
      case 'building': {
        const profileConfig = SCENERY_PROFILES[el.sceneryProfile];
        const [hMin, hMax] = profileConfig.buildings.heightRange;
        const buildingHeightMultiplier = hMin + seededRandom(index * 23 + 11) * (hMax - hMin);
        const buildingHeight = BASE_BUILDING_HEIGHT * buildingHeightMultiplier;
        const roofY = buildingHeight * 1.04;
        const halfHeight = buildingHeight / 2;
        return (
          <group key={`${side}-building-${index}`} name={LANDSCAPE_ELEMENT_NAME} position={[el.position.x, 0, el.position.z]} rotation={[0, el.rotation, 0]}>
            <mesh position={[0, halfHeight * el.scale, 0]} castShadow={castNearShadow} receiveShadow>
              <boxGeometry args={[4.2 * el.scale, buildingHeight * el.scale, 4.2 * el.scale]} />
              <meshPhysicalMaterial color={archConfig.wallMaterial.color} roughness={archConfig.wallMaterial.roughness} metalness={0.08} clearcoat={0.12} clearcoatRoughness={0.75} sheen={0.1} sheenColor={colors.buildingAccent} />
            </mesh>
            {/* Gabled: the only roof the village has since #361 (#364). */}
            <mesh position={[0, roofY * el.scale, 0]} castShadow={castNearShadow}>
              <coneGeometry args={[3.5 * el.scale, 3 * el.scale, 3]} />
              <meshPhysicalMaterial color={archConfig.roofColor} roughness={0.7} metalness={0.1} />
            </mesh>
            {isNearBuilding && [0.22, 0.42, 0.62, 0.82].map((yPos, j) => (
              <React.Fragment key={j}>
                <mesh position={[2.12 * el.scale, buildingHeight * el.scale * yPos, 0]} castShadow={castNearShadow}>
                  <boxGeometry args={[0.06 * el.scale, 1.3 * el.scale, 2.6 * el.scale]} />
                  <meshPhysicalMaterial color="#0a1a2a" roughness={0.04} metalness={0.98} reflectivity={1.0} clearcoat={1.0} clearcoatRoughness={0.01} emissive={colors.windowGlow} emissiveIntensity={seededRandom(index * 17 + j) > 0.5 ? 0.35 : 0.08} ior={1.5} />
                </mesh>
                <mesh position={[-2.12 * el.scale, buildingHeight * el.scale * yPos, 0]} castShadow={castNearShadow}>
                  <boxGeometry args={[0.06 * el.scale, 1.3 * el.scale, 2.6 * el.scale]} />
                  <meshPhysicalMaterial color="#0a1a2a" roughness={0.04} metalness={0.98} reflectivity={1.0} clearcoat={1.0} clearcoatRoughness={0.01} emissive={colors.windowGlow} emissiveIntensity={seededRandom(index * 17 + j + 4) > 0.6 ? 0.3 : 0.06} ior={1.5} />
                </mesh>
              </React.Fragment>
            ))}
            {isNearBuilding && (
              <mesh position={[2.14 * el.scale, halfHeight * el.scale, 0]} castShadow={castNearShadow}>
                <boxGeometry args={[0.02 * el.scale, buildingHeight * el.scale, 2.8 * el.scale]} />
                <meshPhysicalMaterial color="#1a1a1a" roughness={0.9} metalness={0.15} />
              </mesh>
            )}
          </group>
        );
      }
    }
  };
  
  /**
   * Every element is mounted; the frame loop decides which are drawn (#331).
   *
   * This was two `.filter()` calls on a `boatProgress` prop pushed ten times a
   * second, so moving the boat rebuilt the JSX for every tree and house on the
   * bank. The shadow band is measured from the chunk the boat is in, which
   * changes on a cadence a render can afford.
   *
   * Mounted by the progress each element was placed at. It used to be read
   * back from the element's index - `index * 0.02 / 0.6` - which matched where
   * an element stood only for the first of each side, so the window mounted
   * whichever elements happened to be fifteenth to thirtieth in the list
   * rather than the ones near the boat (#333).
   */
  const mounted = (
    elements: typeof landscapeElements.leftElements,
    side: 'left' | 'right',
  ) =>
    elements.flatMap((element, index) => {
      const p = ['oldmount', 'bare', 'bare-maintests', 'bare-kittrees'].includes(import.meta.env.VITE_BENCH_VARIANT ?? '') ? (index * 0.02) / 0.6 : element.progress;
      if (!withinMountRange(p, mountProgress)) return [];
      const nearShadow =
        Math.abs(p - chunkProgress) < RENDER_CONFIG.shadowNearProgressBand;
      return [renderElement(element, index, side, nearShadow)];
    });

  return (
    <>
      <group ref={elementsGroupRef}>
        {mounted(landscapeElements.leftElements, 'left')}
        {mounted(landscapeElements.rightElements, 'right')}
      </group>
      {/* The trees: every one on the route, a mesh per species (#333). */}
      {foliageOn && (
        <BankFoliage
          curve={curve}
          positionRef={positionRef}
          viewDistance={viewDistance}
          enrichment={enrichment}
          track={track}
          avoid={houses}
        />
      )}
    </>
  );
};

// ============================================================================
// PROCEDURAL TERRAIN - Mountains along the banks
// ============================================================================
/**
 * Elevation span, in metres, at which the procedural hills are drawn at their
 * original height. Routes with less relief than this get proportionally lower
 * hills, routes with more get taller ones — bounded, because these are scene
 * dressing on the horizon rather than a survey.
 */
export const REFERENCE_TERRAIN_RANGE_METERS = 120;

export const ProceduralTerrain: React.FC<{
  side: 'left' | 'right';
  /** Where the tiled band sits: the boat's Z, lifted by the local relief (#331). */
  followRef?: React.RefObject<THREE.Vector3 | null>;
  enrichment?: RouteEnrichmentData | null;
}> = ({ side, followRef, enrichment }) => {
  const terrainRef = useRef<THREE.Group>(null);
  useFollowPoint(terrainRef, followRef);
  const xOffset = side === 'left' ? -35 : 35;

  // Before #202 every route got the same 15–40 unit hills from a fixed seed,
  // so a flat canal and an alpine course had identical horizons. Scale that
  // band by how much the route actually climbs. No elevation data leaves the
  // factor at 1, i.e. exactly the previous appearance.
  const reliefFactor = useMemo(() => {
    const { rangeMeters } = buildTerrainProfile(enrichment?.elevations);
    if (rangeMeters <= 0) return 1;
    return Math.max(0.35, Math.min(1.6, rangeMeters / REFERENCE_TERRAIN_RANGE_METERS));
  }, [enrichment?.elevations]);

  const mountains = useMemo(() => {
    const result: Array<{ x: number; z: number; scale: number; height: number; snowLine: number; rockVariant: number }> = [];
    for (let z = -500; z < 500; z += 40) {
      const i = Math.round((z + 500) / 40);
      const height = (15 + seededRandom(i * 11 + 1) * 25) * reliefFactor;
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
  }, [xOffset, reliefFactor]);
  
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
    <group ref={terrainRef}>
      {mountains.map((m, i) => {
        const nearShadow = Math.abs(m.z) < RENDER_CONFIG.shadowNearBand;
        return (
        <group key={i} position={[m.x, 0, m.z]}>
          <mesh position={[0, m.height / 2 - 2, 0]} castShadow={nearShadow} receiveShadow>
            <coneGeometry args={[m.scale, m.height, 8]} />
            <primitive object={rockBodyMaterials[m.rockVariant]} attach="material" />
          </mesh>
          <mesh position={[m.scale * 0.3, m.height * 0.25, m.scale * 0.2]} castShadow={nearShadow}>
            <dodecahedronGeometry args={[m.scale * 0.15, 0]} />
            <primitive object={rockOutcrop1Material} attach="material" />
          </mesh>
          <mesh position={[-m.scale * 0.25, m.height * 0.35, -m.scale * 0.15]} castShadow={nearShadow}>
            <dodecahedronGeometry args={[m.scale * 0.12, 0]} />
            <primitive object={rockOutcrop2Material} attach="material" />
          </mesh>
          <mesh position={[0, m.height * m.snowLine, 0]} castShadow={nearShadow}>
            <coneGeometry args={[m.scale * (1 - m.snowLine) * 1.1, m.height * (1 - m.snowLine) * 1.2, 8]} />
            <primitive object={snowCapMaterial} attach="material" />
          </mesh>
          <mesh position={[m.scale * 0.2, m.height * (m.snowLine - 0.1), m.scale * 0.1]} castShadow={nearShadow}>
            <sphereGeometry args={[m.scale * 0.08, 8, 6]} />
            <primitive object={snowDetailMaterial} attach="material" />
          </mesh>
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
