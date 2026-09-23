import React, { useEffect, useMemo, useRef } from 'react';
import { Billboard, Sky, Cloud } from '@react-three/drei';
import * as THREE from 'three';
import { useAnimationFrame } from './animationFrame';
import { SCENE_CONFIG } from './themeConfig';
import { cloudsFor } from './cloudPlan';
import type { PerformanceMode } from './constants';
import { seededRandom } from './helpers';

/**
 * What one unit of the sky's own numbers is worth, in metres (#321).
 *
 * The clouds and the horizon silhouette are billboards whose only job is to
 * subtend the right angle from the boat. Their distances, heights and scales
 * were authored against the old ten-metre unit, and a distance and a size that
 * both grow by the same factor look identical - so they are converted here with
 * one factor rather than restated twenty times, which would be twenty chances
 * to get one of them wrong.
 *
 * #326 moves the sky and the silhouette to follow the boat's XZ and #346 gives
 * them time-of-day presets; either is the place to author these in metres.
 */
const SKY_UNIT_METRES = 10;

/** The name on the cloud layer, so a test can ask where the sky is (#326). */
export const CLOUD_LAYER_NAME = 'CloudLayer';

// ============================================================================
// HD PHOTOREALISTIC SKYDOME - Enhanced sky with volumetric clouds and HDR lighting
// ============================================================================
export const PhotorealisticSkydome: React.FC<{
  /**
   * Where the boat is. Z alone slid the sky sideways on bends (#326); a ref
   * rather than a prop so following it costs no re-render (#331).
   */
  positionRef: React.RefObject<THREE.Vector3 | null>;
  performanceMode: PerformanceMode;
}> = ({ positionRef, performanceMode }) => {
  const skyConfig = SCENE_CONFIG.sky;
  const cloudConfig = useMemo(() => cloudsFor(performanceMode), [performanceMode]);

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

  /**
   * The sky is never fogged.
   *
   * `Sky` builds its own shader material and takes no `fog` prop, so the flag
   * is set on the instance. Without it the dome is painted out to the fog
   * colour and the scene loses its sun, its gradient and every cloud behind it
   * (#325).
   */
  const skyRef = useRef<THREE.Mesh<THREE.BoxGeometry, THREE.ShaderMaterial> | null>(null);
  useEffect(() => {
    const material = skyRef.current?.material;
    if (material) material.fog = false;
  });

  const cloudGroupRef = useRef<THREE.Group>(null);
  const layer2Ref = useRef<THREE.Group>(null);
  const wispyRef = useRef<THREE.Group>(null);

  useAnimationFrame((time) => {
    // The sky follows the boat here rather than through a prop. It also has to
    // be added to the drift below rather than set beside it: these two lines
    // used to assign `position.x` outright, which overwrote the `boatX` #326
    // put in the JSX - so the cloud layers followed the boat in Z and never in
    // X, which is the bend #326 was about.
    // Nothing to follow yet: the clouds drift and rotate where they are
    // rather than snapping to the origin, which is not a place the boat has
    // ever been.
    const boat = positionRef.current;
    if (!boat) return;
    const { x: boatX, z: boatZ } = boat;

    if (cloudGroupRef.current) {
      cloudGroupRef.current.rotation.y = time * cloudConfig.speed * 0.008;
      cloudGroupRef.current.position.set(boatX + Math.sin(time * 0.015) * 8, 0, boatZ);
    }
    if (layer2Ref.current) {
      layer2Ref.current.rotation.y = time * cloudConfig.speed * 0.004;
      layer2Ref.current.position.set(
        boatX + Math.sin(time * 0.012 + 1) * 12,
        160 * SKY_UNIT_METRES,
        boatZ - 350 * SKY_UNIT_METRES,
      );
    }
    if (wispyRef.current) {
      wispyRef.current.position.set(boatX, 220 * SKY_UNIT_METRES, boatZ - 500 * SKY_UNIT_METRES);
    }
  });

  return (
    <group>
      <Sky
        ref={skyRef}
        distance={500000}
        sunPosition={skyConfig.sunPosition}
        turbidity={skyConfig.turbidity}
        rayleigh={skyConfig.rayleigh}
        mieCoefficient={skyConfig.mieCoefficient}
        mieDirectionalG={skyConfig.mieDirectionalG}
      />

      {cloudConfig.enabled && (
        <group
          ref={cloudGroupRef}
          name={CLOUD_LAYER_NAME}
          scale={SKY_UNIT_METRES}
        >
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
        <group
          ref={layer2Ref}
          scale={SKY_UNIT_METRES}
        >
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
        <group ref={wispyRef} scale={SKY_UNIT_METRES}>
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
// HORIZON SILHOUETTE — distant silhouette using THREE.Shape (#131)
// ============================================================================
export const HorizonSilhouette: React.FC<{
  /** Where the boat is (#326), read in the frame loop rather than pushed (#331). */
  positionRef: React.RefObject<THREE.Vector3 | null>;
}> = ({ positionRef }) => {
  const groupRef = useRef<THREE.Group>(null);
  const horizonConfig = SCENE_CONFIG.horizon;

  const silhouetteGeo = useMemo(() => {
    const shape = new THREE.Shape();
    const width = 300;
    const segments = 60;

    shape.moveTo(-width / 2, 0);

    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const x = -width / 2 + t * width;
      const y = Math.max(0,
        horizonConfig.height * 0.5
        + Math.sin(t * Math.PI * 10) * horizonConfig.height * 0.3
        + seededRandom(i * 3 + 3) * horizonConfig.height * 0.2
      );
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
    // Out of the fog (#325). The silhouette stands well beyond the fog's far
    // plane, so fogging it would paint it out entirely - and it is the thing
    // the fade is supposed to be revealing.
    fog: false,
  }), [horizonConfig.color]);

  useAnimationFrame(() => {
    const group = groupRef.current;
    const boat = positionRef.current;
    if (!group || !boat) return;
    group.position.set(boat.x, 0, boat.z - horizonConfig.distance * SKY_UNIT_METRES);
  });

  return (
    <group ref={groupRef} scale={SKY_UNIT_METRES}>
      {/* Yawed to the camera, and only yawed: `lockX` and `lockZ` keep it
          upright, so it turns about Y like a horizon does and never tips.
          The shape is flat and a rower can come at it from any heading on a
          bend or a loop, where an unturned silhouette shows its edge. */}
      <Billboard lockX lockZ>
        <mesh geometry={silhouetteGeo} material={silhouetteMat} />
      </Billboard>
    </group>
  );
};
