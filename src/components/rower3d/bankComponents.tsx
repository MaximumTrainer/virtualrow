import React, { useMemo, useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { WATER_CHANNEL_WIDTH, RIVERBANK_WIDTH, LANDSCAPE_OFFSET, RENDER_CONFIG } from './constants';
import { seededRandom } from './helpers';
import { useAnimationFrame } from './AnimationContext';
import { getThemeConfig } from './themeConfig';
import type { RouteTheme } from './themeConfig';
import { makeSwayFoliageMaterial } from './vegetationComponents';
import {
  getWaterWidthSceneUnitsForProgress,
  type RouteEnrichmentData,
} from '../../services/routeEnrichmentService';

// ============================================================================
// HD CURVED RIVERBANKS - Follows GPS path with realistic terrain materials
// ============================================================================
export interface CurvedRiverbanksProps {
  curve: THREE.CatmullRomCurve3 | null;
  theme: RouteTheme;
  enrichment?: RouteEnrichmentData | null;
}

export const CurvedRiverbanks: React.FC<CurvedRiverbanksProps> = ({
  curve,
  theme,
  enrichment,
}) => {
  const bankConfig = useMemo(() => getThemeConfig(theme).bank, [theme]);
  
  const { leftBankGeometry, rightBankGeometry } = useMemo(() => {
    if (!curve) return { leftBankGeometry: null, rightBankGeometry: null };
    
    const segments = 200;
    const createBankGeometry = (side: 'left' | 'right') => {
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
        const waterWidth = getWaterWidthSceneUnitsForProgress(
          enrichment?.segmentProfiles,
          enrichment?.waterWidthMeters ?? WATER_CHANNEL_WIDTH / 0.1,
          t,
        );
        const waterHalfWidth = waterWidth / 2;
        const bankWidth = Math.max(RIVERBANK_WIDTH * 0.25, waterWidth * 2.25);
        
        const innerOffset = side === 'left' ? -waterHalfWidth : waterHalfWidth;
        const outerOffset = side === 'left' ? -(waterHalfWidth + bankWidth) : (waterHalfWidth + bankWidth);
        
        const inner = new THREE.Vector3().copy(point).addScaledVector(perp, innerOffset);
        const outer = new THREE.Vector3().copy(point).addScaledVector(perp, outerOffset);
        
        inner.y = -0.5;
        outer.y = -0.5;
        
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
  }, [curve, enrichment]);

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
  enrichment?: RouteEnrichmentData | null;
}

const getSegmentStyle = (
  enrichment: RouteEnrichmentData | null | undefined,
  progress: number,
) => {
  const segmentProfiles = enrichment?.segmentProfiles;
  if (!segmentProfiles || segmentProfiles.length === 0) {
    return {
      treeDensity: 0.45,
      vegetationDensity: 0.5,
      buildingDensity: 0.12,
      objectScale: 1,
    };
  }

  const clampedProgress = Math.max(0, Math.min(1, progress));
  const lastIndex = segmentProfiles.length - 1;
  const scaledIndex = clampedProgress * lastIndex;
  const lowerIndex = Math.floor(scaledIndex);
  const upperIndex = Math.min(lastIndex, lowerIndex + 1);
  const blend = scaledIndex - lowerIndex;
  const lower = segmentProfiles[lowerIndex];
  const upper = segmentProfiles[upperIndex];

  return {
    treeDensity: lower.treeDensity + (upper.treeDensity - lower.treeDensity) * blend,
    vegetationDensity:
      lower.vegetationDensity +
      (upper.vegetationDensity - lower.vegetationDensity) * blend,
    buildingDensity:
      lower.buildingDensity + (upper.buildingDensity - lower.buildingDensity) * blend,
    objectScale: lower.objectScale + (upper.objectScale - lower.objectScale) * blend,
  };
};

export const CurvedLandscapeElements: React.FC<CurvedLandscapeProps> = ({
  curve,
  theme,
  boatProgress,
  enrichment,
}) => {
  const landscapeElements = useMemo(() => {
    if (!curve) return { leftElements: [], rightElements: [] };
    
    const leftElements: Array<{ position: THREE.Vector3; type: 'tree' | 'mountain' | 'building'; scale: number; rotation: number }> = [];
    const rightElements: Array<{ position: THREE.Vector3; type: 'tree' | 'mountain' | 'building'; scale: number; rotation: number }> = [];
    
    const elementSpacing = 0.02;
    const minOffset = LANDSCAPE_OFFSET;
    
    let elemIdx = 0;
    for (let t = 0; t < 1; t += elementSpacing) {
      const point = curve.getPointAt(t);
      const tangent = curve.getTangentAt(t).normalize();
      const up = new THREE.Vector3(0, 1, 0);
      const perp = new THREE.Vector3().crossVectors(tangent, up).normalize();
      const segmentStyle = getSegmentStyle(enrichment, t);
      
      const leftOffset =
        minOffset +
        seededRandom(elemIdx * 7 + 1) * (16 + (1 - segmentStyle.vegetationDensity) * 34);
      const rightOffset =
        minOffset +
        seededRandom(elemIdx * 7 + 2) * (16 + (1 - segmentStyle.vegetationDensity) * 34);
      
      const getElementType = (seedOffset: number): 'tree' | 'mountain' | 'building' => {
        const rand = seededRandom(elemIdx * 7 + seedOffset);
        const buildingThreshold = Math.min(0.8, segmentStyle.buildingDensity * 0.85);
        const treeThreshold = Math.min(
          0.98,
          buildingThreshold + Math.max(0.18, segmentStyle.treeDensity * 0.75),
        );
        if (rand < buildingThreshold) return 'building';
        if (rand < treeThreshold) return 'tree';
        return 'mountain';
      };
      
      const placementChance = 0.1 + segmentStyle.treeDensity * 0.55 + segmentStyle.vegetationDensity * 0.2;
      if (seededRandom(elemIdx * 7 + 4) < placementChance) {
        const leftPos = new THREE.Vector3().copy(point).addScaledVector(perp, -leftOffset);
        leftPos.y = 0;
        leftElements.push({
          position: leftPos,
          type: getElementType(3),
          scale: (0.8 + seededRandom(elemIdx * 7 + 5) * 0.8) * segmentStyle.objectScale,
          rotation: Math.atan2(tangent.x, tangent.z) + Math.PI / 2
        });
      }
      
      if (seededRandom(elemIdx * 7 + 6) < placementChance) {
        const rightPos = new THREE.Vector3().copy(point).addScaledVector(perp, rightOffset);
        rightPos.y = 0;
        rightElements.push({
          position: rightPos,
          type: getElementType(7),
          scale: (0.8 + seededRandom(elemIdx * 7 + 8) * 0.8) * segmentStyle.objectScale,
          rotation: Math.atan2(tangent.x, tangent.z) - Math.PI / 2
        });
      }
      elemIdx++;
    }
    
    return { leftElements, rightElements };
  }, [curve, enrichment]);
  
  const colors = useMemo(() => getThemeConfig(theme).landscapeColors, [theme]);
  const archConfig = useMemo(() => getThemeConfig(theme).architecture, [theme]);
  const { camera } = useThree();

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
  
  const visibleRange = 0.15;
  const filteredLeft = landscapeElements.leftElements.filter((_, i) => {
    const elementProgress = i * 0.02 / 0.6;
    return Math.abs(elementProgress - boatProgress) < visibleRange || elementProgress < 0.1;
  });
  const filteredRight = landscapeElements.rightElements.filter((_, i) => {
    const elementProgress = i * 0.02 / 0.6;
    return Math.abs(elementProgress - boatProgress) < visibleRange || elementProgress < 0.1;
  });
  
  const renderElement = (el: typeof landscapeElements.leftElements[0], index: number, side: string, castNearShadow: boolean) => {
    const distToCamera = camera.position.distanceTo(el.position);
    const isNearTree = distToCamera <= 40;
    const isNearBuilding = distToCamera <= 60;

    switch (el.type) {
      case 'tree':
        return (
          <group key={`${side}-tree-${index}`} position={[el.position.x, el.position.y, el.position.z]} rotation={[0, el.rotation, 0]}>
            <mesh position={[0, 2 * el.scale, 0]} castShadow={castNearShadow}>
              <cylinderGeometry args={[0.22 * el.scale, 0.42 * el.scale, 4.2 * el.scale, 16]} />
              <meshPhysicalMaterial color={colors.treeBark} roughness={0.96} metalness={0.0} clearcoat={0.02} clearcoatRoughness={0.98} sheen={0.05} sheenColor="#2a1a10" />
            </mesh>
            <mesh position={[0, 0.15 * el.scale, 0]} castShadow={castNearShadow}>
              <cylinderGeometry args={[0.38 * el.scale, 0.65 * el.scale, 0.45 * el.scale, 10]} />
              <meshPhysicalMaterial color={colors.treeBark} roughness={0.97} metalness={0.0} sheen={0.03} sheenColor="#1a1008" />
            </mesh>
            {[0, 1.2, 2.4, 3.6, 4.8].map((angle, j) => (
              <mesh key={j} position={[Math.cos(angle) * 0.5 * el.scale, 0.05, Math.sin(angle) * 0.5 * el.scale]} rotation={[0.3, angle, 0.4]} castShadow={castNearShadow}>
                <cylinderGeometry args={[0.06 * el.scale, 0.1 * el.scale, 0.6 * el.scale, 6]} />
                <meshPhysicalMaterial color={colors.treeBark} roughness={0.98} />
              </mesh>
            ))}
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
            <mesh position={[0, 8.0 * el.scale, 0]} castShadow={castNearShadow}>
              <coneGeometry args={[0.6 * el.scale, 2.0 * el.scale, isNearTree ? 12 : 4]} />
              <primitive object={curveFoliageMats[3]} attach="material" />
            </mesh>
          </group>
        );
      case 'mountain':
        return (
          <group key={`${side}-mountain-${index}`} position={[el.position.x, 0, el.position.z]}>
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
      case 'building':
        return (
          <group key={`${side}-building-${index}`} position={[el.position.x, 0, el.position.z]} rotation={[0, el.rotation, 0]}>
            <mesh position={[0, 6 * el.scale, 0]} castShadow={castNearShadow} receiveShadow>
              <boxGeometry args={[4.2 * el.scale, 12.5 * el.scale, 4.2 * el.scale]} />
              <meshPhysicalMaterial color={archConfig.wallMaterial.color} roughness={archConfig.wallMaterial.roughness} metalness={0.08} clearcoat={0.12} clearcoatRoughness={0.75} sheen={0.1} sheenColor={colors.buildingAccent} />
            </mesh>
            {archConfig.roofStyle === 'pointed' ? (
              <mesh position={[0, 13 * el.scale, 0]} castShadow={castNearShadow}>
                <coneGeometry args={[3 * el.scale, 4 * el.scale, 4]} />
                <meshPhysicalMaterial color={archConfig.roofColor} roughness={0.65} metalness={0.12} clearcoat={0.1} />
              </mesh>
            ) : archConfig.roofStyle === 'gabled' ? (
              <mesh position={[0, 13 * el.scale, 0]} castShadow={castNearShadow}>
                <coneGeometry args={[3.5 * el.scale, 3 * el.scale, 3]} />
                <meshPhysicalMaterial color={archConfig.roofColor} roughness={0.7} metalness={0.1} />
              </mesh>
            ) : (
              <>
                <mesh position={[0, 12.5 * el.scale, 0]} castShadow={castNearShadow}>
                  <boxGeometry args={[4.5 * el.scale, 0.5 * el.scale, 4.5 * el.scale]} />
                  <meshPhysicalMaterial color={archConfig.roofColor} roughness={0.78} metalness={0.12} clearcoat={0.08} />
                </mesh>
                <mesh position={[0, 12.8 * el.scale, 0]} castShadow={castNearShadow}>
                  <boxGeometry args={[3.8 * el.scale, 0.3 * el.scale, 3.8 * el.scale]} />
                  <meshPhysicalMaterial color="#2a2a2a" roughness={0.88} metalness={0.1} />
                </mesh>
              </>
            )}
            {isNearBuilding && [0.22, 0.42, 0.62, 0.82].map((yPos, j) => (
              <React.Fragment key={j}>
                <mesh position={[2.12 * el.scale, 12 * el.scale * yPos, 0]} castShadow={castNearShadow}>
                  <boxGeometry args={[0.06 * el.scale, 1.3 * el.scale, 2.6 * el.scale]} />
                  <meshPhysicalMaterial color="#0a1a2a" roughness={0.04} metalness={0.98} reflectivity={1.0} clearcoat={1.0} clearcoatRoughness={0.01} emissive={colors.windowGlow} emissiveIntensity={seededRandom(index * 17 + j) > 0.5 ? 0.35 : 0.08} ior={1.5} />
                </mesh>
                <mesh position={[-2.12 * el.scale, 12 * el.scale * yPos, 0]} castShadow={castNearShadow}>
                  <boxGeometry args={[0.06 * el.scale, 1.3 * el.scale, 2.6 * el.scale]} />
                  <meshPhysicalMaterial color="#0a1a2a" roughness={0.04} metalness={0.98} reflectivity={1.0} clearcoat={1.0} clearcoatRoughness={0.01} emissive={colors.windowGlow} emissiveIntensity={seededRandom(index * 17 + j + 4) > 0.6 ? 0.3 : 0.06} ior={1.5} />
                </mesh>
              </React.Fragment>
            ))}
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
export const ProceduralTerrain: React.FC<{ side: 'left' | 'right'; boatZ: number }> = ({ side, boatZ }) => {
  const xOffset = side === 'left' ? -35 : 35;
  
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
