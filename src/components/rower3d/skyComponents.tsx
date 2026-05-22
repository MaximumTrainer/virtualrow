import React, { useRef, useMemo } from 'react';
import { Sky, Cloud } from '@react-three/drei';
import * as THREE from 'three';
import { useAnimationFrame } from './AnimationContext';
import { getThemeConfig } from './themeConfig';
import type { RouteTheme } from './themeConfig';
import { seededRandom } from './helpers';

// ============================================================================
// HD PHOTOREALISTIC SKYDOME - Enhanced sky with volumetric clouds and HDR lighting
// ============================================================================
export const PhotorealisticSkydome: React.FC<{ theme: RouteTheme; boatZ: number }> = ({ theme, boatZ }) => {
  const skyConfig = useMemo(() => getThemeConfig(theme).sky, [theme]);
  const cloudConfig = useMemo(() => getThemeConfig(theme).clouds, [theme]);

  const cloudPositions = useMemo(() => {
    const positions: Array<{ x: number; y: number; z: number; scale: number; variation: number }> = [];
    for (let i = 0; i < cloudConfig.count; i++) {
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

  const cloudGroupRef = useRef<THREE.Group>(null);
  const layer2Ref = useRef<THREE.Group>(null);

  useAnimationFrame((time) => {
    if (cloudGroupRef.current) {
      cloudGroupRef.current.rotation.y = time * cloudConfig.speed * 0.008;
      cloudGroupRef.current.position.x = Math.sin(time * 0.015) * 8;
    }
    if (layer2Ref.current) {
      layer2Ref.current.rotation.y = time * cloudConfig.speed * 0.004;
      layer2Ref.current.position.x = Math.sin(time * 0.012 + 1) * 12;
    }
  });

  return (
    <group>
      <Sky
        distance={500000}
        sunPosition={skyConfig.sunPosition}
        turbidity={skyConfig.turbidity}
        rayleigh={skyConfig.rayleigh}
        mieCoefficient={skyConfig.mieCoefficient}
        mieDirectionalG={skyConfig.mieDirectionalG}
      />

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
// HORIZON SILHOUETTE — distant silhouette per theme using THREE.Shape (#131)
// ============================================================================
export const HorizonSilhouette: React.FC<{ boatZ: number; theme: RouteTheme }> = ({ boatZ, theme }) => {
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
          y = Math.max(0,
            seededRandom(i * 3 + 1) * 0.4 * horizonConfig.height
            + Math.sin(t * Math.PI * 4) * 0.5 * horizonConfig.height
            + Math.sin(t * Math.PI * 7 + 1.2) * 0.3 * horizonConfig.height
          );
          break;
        }
        case 'city': {
          const buildingIdx = Math.floor(t * 20);
          const buildingH = seededRandom(buildingIdx * 5 + 2) * horizonConfig.height;
          y = buildingH;
          break;
        }
        case 'hills': {
          y = Math.max(0,
            horizonConfig.height * 0.5
            + Math.sin(t * Math.PI * 10) * horizonConfig.height * 0.3
            + seededRandom(i * 3 + 3) * horizonConfig.height * 0.2
          );
          break;
        }
        case 'industrial': {
          const segIdx = Math.floor(t * 15);
          const isChimney = seededRandom(segIdx * 7 + 4) > 0.75;
          y = isChimney
            ? horizonConfig.height * (0.6 + seededRandom(segIdx * 7 + 5) * 0.6)
            : seededRandom(segIdx * 7 + 6) * horizonConfig.height * 0.5;
          break;
        }
        case 'islands': {
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

  const silhouetteMat = useMemo(() => new THREE.MeshBasicMaterial({
    color: horizonConfig.color,
    side: THREE.FrontSide,
    transparent: true,
    opacity: 0.85,
  }), [horizonConfig.color]);

  return (
    <group position={[0, 0, boatZ - horizonConfig.distance]}>
      <mesh geometry={silhouetteGeo} material={silhouetteMat} />
    </group>
  );
};
